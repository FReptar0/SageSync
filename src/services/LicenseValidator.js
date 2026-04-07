/**
 * License Validator Service
 *
 * Singleton service that verifies license validity against the remote
 * license server with HMAC signature verification, timestamp freshness
 * checking, retry with exponential backoff, and a three-state cached model.
 *
 * Three states:
 *   VALID   - License confirmed active. Operate normally.
 *   INVALID - License explicitly revoked/expired. Block everything.
 *   ERROR   - Server unreachable / bad response. Keep cached state for up to 24h.
 *
 * Exports: validate(), isValid(), getStatus(), _reset()
 */

const crypto = require('crypto');
const dns = require('dns');
const { URL } = require('url');
const axios = require('axios');
const licenseConfig = require('../config/license');
const logger = require('../config/logger');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const FRESHNESS_WINDOW_MS = 5 * 60 * 1000;       // 5 minutes
const FUTURE_TOLERANCE_MS = 60 * 1000;             // 60 seconds
const ERROR_TTL_MS = 24 * 60 * 60 * 1000;         // 24 hours
const STARTUP_RETRIES = 3;
const STARTUP_BACKOFF_BASE_MS = 1000;              // 1s, 2s, 4s
const HTTP_TIMEOUT_MS = 10000;                      // 10 seconds

// ---------------------------------------------------------------------------
// Internal state (singleton)
// ---------------------------------------------------------------------------
let cachedState = {
    state: 'UNKNOWN',          // 'VALID' | 'INVALID' | 'ERROR' | 'UNKNOWN'
    active: false,
    expiresAt: null,
    lastChecked: null,
    lastSuccessfulCheck: null, // timestamp of last VALID/INVALID (non-ERROR) check
    error: null,
};

// ---------------------------------------------------------------------------
// Dedicated HTTP client
// ---------------------------------------------------------------------------
const licenseClient = axios.create({
    timeout: HTTP_TIMEOUT_MS,
    headers: { 'Accept': 'application/json' },
});

// ---------------------------------------------------------------------------
// Sleep helper for retry backoff
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// HMAC Signature Verification
// ---------------------------------------------------------------------------
/**
 * Verify the HMAC-SHA256 signature of a license server response.
 * Uses explicit payload construction matching the server's exact field order
 * to avoid obfuscation-related key ordering issues.
 *
 * @param {Object} responseData - The response body from the license server
 * @param {string} hmacSecret - The shared HMAC secret
 * @returns {boolean} True if signature is valid
 */
function verifySignature(responseData, hmacSecret) {
    if (!responseData || !responseData.sig) return false;

    // Build payload in EXACT field order the server uses:
    // Success: { active: true, expiresAt: "...", ts: N }
    // Failure: { active: false, ts: N }
    const payload = { active: responseData.active };
    if (responseData.active === true && responseData.expiresAt !== undefined) {
        payload.expiresAt = responseData.expiresAt;
    }
    payload.ts = responseData.ts;

    const expected = crypto
        .createHmac('sha256', hmacSecret)
        .update(JSON.stringify(payload), 'utf-8')
        .digest('hex');

    // Constant-time comparison to prevent timing attacks
    const expectedBuf = Buffer.from(expected, 'utf8');
    const sigBuf = Buffer.from(String(responseData.sig), 'utf8');
    if (expectedBuf.length !== sigBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, sigBuf);
}

// ---------------------------------------------------------------------------
// Timestamp Freshness Check
// ---------------------------------------------------------------------------
/**
 * Check if a response timestamp is fresh enough to be trusted.
 * Rejects timestamps older than 5 minutes or more than 60s in the future.
 *
 * @param {number} ts - Server timestamp (Date.now() on server)
 * @returns {boolean} True if timestamp is fresh
 */
function checkTimestampFreshness(ts) {
    const now = Date.now();
    const age = now - ts;
    // Reject if older than 5 minutes
    if (age > FRESHNESS_WINDOW_MS) return false;
    // Reject if more than 60s in the future (clock skew protection)
    if (age < -FUTURE_TOLERANCE_MS) return false;
    return true;
}

// ---------------------------------------------------------------------------
// Core: validate()
// ---------------------------------------------------------------------------
/**
 * Validate the license against the remote server.
 *
 * @param {Object} [options={}] - Options
 * @param {boolean} [options.startup=false] - If true, retries 3 times and exits on failure
 * @returns {Promise<{valid: boolean, expiresAt: string|null, error: string|null, state: string}>}
 */
async function validate(options) {
    var startup = (options && options.startup) || false;

    // Log HMAC secret prefix on first call for mismatch debugging
    if (licenseConfig.hmacSecret) {
        logger.info('[LICENSE] HMAC secret loaded (prefix: ' + licenseConfig.hmacSecret.slice(0, 8) + '...)');
    }

    var result = await _doValidate();

    // Startup retry logic
    if (startup && result.state !== 'VALID') {
        for (var attempt = 0; attempt < STARTUP_RETRIES; attempt++) {
            var backoffMs = STARTUP_BACKOFF_BASE_MS * Math.pow(2, attempt);
            logger.warn('[LICENSE] Startup retry ' + (attempt + 1) + '/' + STARTUP_RETRIES + ' in ' + backoffMs + 'ms');
            await sleep(backoffMs);

            result = await _doValidate();
            if (result.state === 'VALID') break;
        }

        if (result.state !== 'VALID') {
            logger.error('[LICENSE] All startup retries exhausted. Final state: ' + result.state);
            process.exit(1);
        }
    }

    return result;
}

// ---------------------------------------------------------------------------
// DNS Bypass Detection (defense-in-depth)
// ---------------------------------------------------------------------------

/**
 * Check if an IPv4 address is private (RFC 1918) or loopback.
 * @param {string} ip - IPv4 address string
 * @returns {boolean} True if private or loopback
 */
function _isPrivateOrLoopback(ip) {
    var parts = ip.split('.').map(Number);
    // 127.0.0.0/8 (loopback)
    if (parts[0] === 127) return true;
    // 10.0.0.0/8
    if (parts[0] === 10) return true;
    // 172.16.0.0/12
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.168.0.0/16
    if (parts[0] === 192 && parts[1] === 168) return true;
    return false;
}

/**
 * Defense-in-depth: verify license server hostname resolves to a public IP.
 * Uses dns.resolve4() which bypasses the OS hosts file (unlike dns.lookup()).
 * Warns on private/loopback IPs but does NOT block -- HMAC is the primary gate.
 */
async function _checkDns() {
    try {
        var hostname = new URL(licenseConfig.apiUrl).hostname;
        var addresses = await new Promise(function (resolve, reject) {
            dns.resolve4(hostname, function (err, addrs) {
                if (err) reject(err);
                else resolve(addrs);
            });
        });

        for (var i = 0; i < addresses.length; i++) {
            var addr = addresses[i];
            if (_isPrivateOrLoopback(addr)) {
                logger.warn('[LICENSE] DNS WARNING: ' + hostname + ' resolved to private/loopback IP ' + addr + ' -- possible hosts file redirect');
                return; // warn once, do not repeat for each address
            }
        }
    } catch (err) {
        logger.warn('[LICENSE] DNS check failed for license server: ' + err.message + ' (non-blocking)');
    }
}

// ---------------------------------------------------------------------------
// Core: _doValidate()
// ---------------------------------------------------------------------------

/**
 * Internal: perform a single validation attempt.
 * @returns {Promise<{valid: boolean, expiresAt: string|null, error: string|null, state: string}>}
 */
async function _doValidate() {
    // Defense-in-depth DNS check (non-blocking)
    await _checkDns();

    try {
        var url = licenseConfig.apiUrl + '/api/validate?key=' + licenseConfig.apiKey;
        var response = await licenseClient.get(url);
        var data = response.data;

        // 1. Verify HMAC signature
        if (!verifySignature(data, licenseConfig.hmacSecret)) {
            logger.warn('[LICENSE] HMAC signature mismatch -- verify HMAC_SECRET matches the license server');
            cachedState.state = 'ERROR';
            cachedState.error = 'HMAC signature mismatch';
            cachedState.lastChecked = new Date().toISOString();
            _checkErrorTTL();
            return _buildResult();
        }

        // 2. Check timestamp freshness
        if (!checkTimestampFreshness(data.ts)) {
            var age = Date.now() - data.ts;
            logger.warn('[LICENSE] Response timestamp stale (age: ' + age + 'ms, max: ' + FRESHNESS_WINDOW_MS + 'ms)');
            cachedState.state = 'ERROR';
            cachedState.error = 'Stale timestamp';
            cachedState.lastChecked = new Date().toISOString();
            _checkErrorTTL();
            return _buildResult();
        }

        // 3. Process validated response
        if (data.active === true) {
            cachedState.state = 'VALID';
            cachedState.active = true;
            cachedState.expiresAt = data.expiresAt || null;
            cachedState.lastChecked = new Date().toISOString();
            cachedState.lastSuccessfulCheck = new Date().toISOString();
            cachedState.error = null;
            logger.info('[LICENSE] License VALID. Expires: ' + cachedState.expiresAt);
        } else {
            cachedState.state = 'INVALID';
            cachedState.active = false;
            cachedState.expiresAt = null;
            cachedState.lastChecked = new Date().toISOString();
            cachedState.lastSuccessfulCheck = new Date().toISOString();
            cachedState.error = null;
            logger.warn('[LICENSE] License INVALID (revoked or expired)');
        }

        return _buildResult();
    } catch (err) {
        // Network error / timeout
        logger.error('[LICENSE] Validation request failed: ' + err.message);
        cachedState.state = 'ERROR';
        cachedState.error = err.message;
        cachedState.lastChecked = new Date().toISOString();
        _checkErrorTTL();
        return _buildResult();
    }
}

/**
 * Check if ERROR state has exceeded the 24h TTL.
 * If lastSuccessfulCheck is older than ERROR_TTL_MS, switch to INVALID.
 */
function _checkErrorTTL() {
    if (cachedState.lastSuccessfulCheck) {
        var lastSuccess = new Date(cachedState.lastSuccessfulCheck).getTime();
        var elapsed = Date.now() - lastSuccess;
        if (elapsed > ERROR_TTL_MS) {
            logger.error('[LICENSE] ERROR state exceeded 24h TTL. Switching to INVALID.');
            cachedState.state = 'INVALID';
            cachedState.active = false;
            cachedState.error = 'Error TTL exceeded (24h without successful check)';
        }
    }
}

/**
 * Build the return result from current cached state.
 * @returns {{valid: boolean, expiresAt: string|null, error: string|null, state: string}}
 */
function _buildResult() {
    return {
        valid: cachedState.state === 'VALID',
        expiresAt: cachedState.expiresAt,
        error: cachedState.error,
        state: cachedState.state,
    };
}

// ---------------------------------------------------------------------------
// Sync accessors
// ---------------------------------------------------------------------------

/**
 * Returns cached boolean -- synchronous, no HTTP call.
 * @returns {boolean} True only if last validated state is VALID
 */
function isValid() {
    return cachedState.state === 'VALID';
}

/**
 * Returns full cached state object for API consumption -- synchronous.
 * @returns {{active: boolean, expiresAt: string|null, lastChecked: string|null, state: string, lastSuccessfulCheck: string|null}}
 */
function getStatus() {
    return {
        active: cachedState.active,
        expiresAt: cachedState.expiresAt,
        lastChecked: cachedState.lastChecked,
        state: cachedState.state,
        lastSuccessfulCheck: cachedState.lastSuccessfulCheck,
    };
}

// ---------------------------------------------------------------------------
// Reset (for testing only)
// ---------------------------------------------------------------------------
function _reset() {
    cachedState = {
        state: 'UNKNOWN',
        active: false,
        expiresAt: null,
        lastChecked: null,
        lastSuccessfulCheck: null,
        error: null,
    };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = { validate, isValid, getStatus, _reset };
