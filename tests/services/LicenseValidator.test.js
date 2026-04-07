'use strict';

/**
 * Unit tests for LicenseValidator service
 * Covers: CFG-01, CFG-02, LIC-01, LIC-02, LIC-03, LIC-04, ENF-03, ENF-04
 */

const crypto = require('crypto');

// ---- Mocks must be declared before requiring the module under test ----

// The LicenseValidator creates a licenseClient via axios.create() at module
// load time. We must provide the mock factory so it returns a controllable
// object when the module is first required.
const mockAxiosGet = jest.fn();
const mockAxiosClient = { get: mockAxiosGet };

jest.mock('axios', () => ({
    create: jest.fn(() => mockAxiosClient),
}));

jest.mock('dns');
jest.mock('../../src/config/license', () => ({
    apiUrl: 'https://test-license.example.com',
    hmacSecret: 'test-hmac-secret-key',
    apiKey: 'test-api-key',
}));

// Logger is already mocked globally by tests/setup.js

const dns = require('dns');
const licenseConfig = require('../../src/config/license');
const { validate, isValid, getStatus, _reset } = require('../../src/services/LicenseValidator');

// ---------------------------------------------------------------------------
// Helper: generate properly HMAC-signed response
// ---------------------------------------------------------------------------
function makeSignedResponse(active, expiresAt, hmacSecret, tsOverride) {
    const payload = { active };
    if (active === true && expiresAt !== undefined) {
        payload.expiresAt = expiresAt;
    }
    payload.ts = tsOverride !== undefined ? tsOverride : Date.now();
    const sig = crypto
        .createHmac('sha256', hmacSecret)
        .update(JSON.stringify(payload), 'utf-8')
        .digest('hex');
    return { ...payload, sig };
}

beforeEach(() => {
    _reset();
    jest.clearAllMocks();

    // Default DNS mock -- resolves to public IP (no warning)
    dns.resolve4 = jest.fn((hostname, cb) => cb(null, ['104.26.10.1']));
});

afterEach(() => {
    jest.useRealTimers();
});

// ===========================================================================
// CFG-01: Config shape
// ===========================================================================
describe('Config - CFG-01', () => {
    test('license config has apiUrl, hmacSecret, apiKey', () => {
        expect(licenseConfig.apiUrl).toBe('https://test-license.example.com');
        expect(licenseConfig.hmacSecret).toBe('test-hmac-secret-key');
        expect(licenseConfig.apiKey).toBe('test-api-key');
    });

    test('apiUrl is non-empty string', () => {
        expect(typeof licenseConfig.apiUrl).toBe('string');
        expect(licenseConfig.apiUrl.length).toBeGreaterThan(0);
    });
});

// ===========================================================================
// LIC-03: HMAC Signature Verification (tested indirectly via validate())
// ===========================================================================
describe('HMAC Verification - LIC-03', () => {
    test('valid signature leads to VALID state', async () => {
        const response = makeSignedResponse(true, '2027-01-01T00:00:00.000Z', licenseConfig.hmacSecret);
        mockAxiosGet.mockResolvedValueOnce({ data: response });

        const result = await validate();

        expect(result.state).toBe('VALID');
        expect(result.valid).toBe(true);
    });

    test('tampered signature leads to ERROR state', async () => {
        const response = makeSignedResponse(true, '2027-01-01T00:00:00.000Z', licenseConfig.hmacSecret);
        response.sig = 'deadbeef0000000000000000000000000000000000000000000000000000dead';
        mockAxiosGet.mockResolvedValueOnce({ data: response });

        const result = await validate();

        expect(result.state).toBe('ERROR');
        expect(result.valid).toBe(false);
    });

    test('missing sig field leads to ERROR state', async () => {
        const response = makeSignedResponse(true, '2027-01-01T00:00:00.000Z', licenseConfig.hmacSecret);
        delete response.sig;
        mockAxiosGet.mockResolvedValueOnce({ data: response });

        const result = await validate();

        expect(result.state).toBe('ERROR');
    });

    test('modified active field after signing leads to ERROR state', async () => {
        const response = makeSignedResponse(true, '2027-01-01T00:00:00.000Z', licenseConfig.hmacSecret);
        // Flip active after signing -- HMAC should no longer match
        response.active = false;
        mockAxiosGet.mockResolvedValueOnce({ data: response });

        const result = await validate();

        expect(result.state).toBe('ERROR');
    });
});

// ===========================================================================
// LIC-04: Timestamp Freshness (tested indirectly via validate())
// ===========================================================================
describe('Timestamp Freshness - LIC-04', () => {
    test('fresh timestamp (now) results in VALID state', async () => {
        const response = makeSignedResponse(true, '2027-01-01T00:00:00.000Z', licenseConfig.hmacSecret);
        // ts is Date.now() -- already set in makeSignedResponse
        mockAxiosGet.mockResolvedValueOnce({ data: response });

        const result = await validate();

        expect(result.state).toBe('VALID');
    });

    test('stale timestamp (6 min ago) results in ERROR state', async () => {
        const staleTs = Date.now() - 6 * 60 * 1000;
        const response = makeSignedResponse(true, '2027-01-01T00:00:00.000Z', licenseConfig.hmacSecret, staleTs);
        mockAxiosGet.mockResolvedValueOnce({ data: response });

        const result = await validate();

        expect(result.state).toBe('ERROR');
        expect(result.error).toMatch(/stale/i);
    });

    test('far-future timestamp (2 min ahead) results in ERROR state', async () => {
        const futureTs = Date.now() + 2 * 60 * 1000;
        const response = makeSignedResponse(true, '2027-01-01T00:00:00.000Z', licenseConfig.hmacSecret, futureTs);
        mockAxiosGet.mockResolvedValueOnce({ data: response });

        const result = await validate();

        expect(result.state).toBe('ERROR');
    });

    test('slight-future timestamp (30s ahead) results in VALID state (within tolerance)', async () => {
        const slightFutureTs = Date.now() + 30 * 1000;
        const response = makeSignedResponse(true, '2027-01-01T00:00:00.000Z', licenseConfig.hmacSecret, slightFutureTs);
        mockAxiosGet.mockResolvedValueOnce({ data: response });

        const result = await validate();

        expect(result.state).toBe('VALID');
    });
});

// ===========================================================================
// CFG-02: DNS Check -- warns on private/loopback IPs
// ===========================================================================
describe('DNS Check - CFG-02', () => {
    const logger = require('../../src/config/logger');

    test('resolves to private IP 127.0.0.1 logs warning', async () => {
        dns.resolve4 = jest.fn((hostname, cb) => cb(null, ['127.0.0.1']));
        const response = makeSignedResponse(true, '2027-01-01T00:00:00.000Z', licenseConfig.hmacSecret);
        mockAxiosGet.mockResolvedValueOnce({ data: response });

        await validate();

        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('private/loopback')
        );
    });

    test('resolves to private IP 10.0.0.1 logs warning', async () => {
        dns.resolve4 = jest.fn((hostname, cb) => cb(null, ['10.0.0.1']));
        const response = makeSignedResponse(true, '2027-01-01T00:00:00.000Z', licenseConfig.hmacSecret);
        mockAxiosGet.mockResolvedValueOnce({ data: response });

        await validate();

        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('private/loopback')
        );
    });

    test('resolves to private IP 192.168.1.1 logs warning', async () => {
        dns.resolve4 = jest.fn((hostname, cb) => cb(null, ['192.168.1.1']));
        const response = makeSignedResponse(true, '2027-01-01T00:00:00.000Z', licenseConfig.hmacSecret);
        mockAxiosGet.mockResolvedValueOnce({ data: response });

        await validate();

        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('private/loopback')
        );
    });

    test('resolves to public IP 104.26.10.1 does NOT log DNS warning', async () => {
        dns.resolve4 = jest.fn((hostname, cb) => cb(null, ['104.26.10.1']));
        const response = makeSignedResponse(true, '2027-01-01T00:00:00.000Z', licenseConfig.hmacSecret);
        mockAxiosGet.mockResolvedValueOnce({ data: response });

        await validate();

        // logger.warn may be called for other reasons, but NOT for private/loopback DNS
        const warnCalls = logger.warn.mock.calls.map((c) => c[0]);
        const hasDnsWarn = warnCalls.some((msg) => msg.includes('private/loopback'));
        expect(hasDnsWarn).toBe(false);
    });
});

// ===========================================================================
// LIC-01 + ENF-03: Startup validation with retries and exit
// ===========================================================================
describe('Validate - Startup - LIC-01, ENF-03', () => {
    let exitSpy;

    beforeEach(() => {
        exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {
            // Mock prevents actual exit
        });
    });

    afterEach(() => {
        exitSpy.mockRestore();
    });

    test('successful validation on first attempt returns VALID state', async () => {
        const response = makeSignedResponse(true, '2027-01-01T00:00:00.000Z', licenseConfig.hmacSecret);
        mockAxiosGet.mockResolvedValueOnce({ data: response });

        const result = await validate({ startup: true });

        expect(result.state).toBe('VALID');
        expect(exitSpy).not.toHaveBeenCalled();
    });

    test('failure then success on retry returns VALID state', async () => {
        // First call fails (network error), second call succeeds
        mockAxiosGet
            .mockRejectedValueOnce(new Error('Network error'))
            .mockResolvedValueOnce({
                data: makeSignedResponse(true, '2027-01-01T00:00:00.000Z', licenseConfig.hmacSecret),
            });

        const result = await validate({ startup: true });

        expect(result.state).toBe('VALID');
        expect(exitSpy).not.toHaveBeenCalled();
        expect(mockAxiosGet).toHaveBeenCalledTimes(2);
    });

    test('all retries exhausted calls process.exit(1)', async () => {
        // All 4 attempts fail (1 initial + 3 retries)
        mockAxiosGet.mockRejectedValue(new Error('Server down'));

        await validate({ startup: true });

        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    test('retry count is exactly 3 after initial failure (4 total attempts)', async () => {
        mockAxiosGet.mockRejectedValue(new Error('Server down'));

        await validate({ startup: true });

        // 1 initial + 3 retries = 4 total attempts
        expect(mockAxiosGet).toHaveBeenCalledTimes(4);
        expect(exitSpy).toHaveBeenCalledWith(1);
    });
});

// ===========================================================================
// LIC-02: Periodic validation (no startup flag) -- cron re-validation path
// ===========================================================================
describe('Validate - Periodic - LIC-02', () => {
    let exitSpy;

    beforeEach(() => {
        exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
    });

    afterEach(() => {
        exitSpy.mockRestore();
    });

    test('periodic validation (no startup flag) returns result without process.exit', async () => {
        mockAxiosGet.mockRejectedValueOnce(new Error('Server error'));

        const result = await validate(); // no startup flag

        expect(result).toBeDefined();
        expect(exitSpy).not.toHaveBeenCalled();
    });

    test('periodic validation with server error returns ERROR state (not exit)', async () => {
        mockAxiosGet.mockRejectedValueOnce(new Error('Timeout'));

        const result = await validate();

        expect(result.state).toBe('ERROR');
        expect(exitSpy).not.toHaveBeenCalled();
    });

    test('periodic validation can be called multiple times, each call re-checks the license server', async () => {
        const response = makeSignedResponse(true, '2027-01-01T00:00:00.000Z', licenseConfig.hmacSecret);

        // Simulate 3 cron cycles -- each should call the HTTP endpoint
        mockAxiosGet
            .mockResolvedValueOnce({ data: makeSignedResponse(true, '2027-01-01T00:00:00.000Z', licenseConfig.hmacSecret) })
            .mockResolvedValueOnce({ data: makeSignedResponse(true, '2027-01-01T00:00:00.000Z', licenseConfig.hmacSecret) })
            .mockResolvedValueOnce({ data: makeSignedResponse(true, '2027-01-01T00:00:00.000Z', licenseConfig.hmacSecret) });

        _reset();
        const r1 = await validate();
        _reset(); // Reset between calls to simulate new cycles hitting the server
        const r2 = await validate();
        _reset();
        const r3 = await validate();

        expect(r1.state).toBe('VALID');
        expect(r2.state).toBe('VALID');
        expect(r3.state).toBe('VALID');
        expect(mockAxiosGet).toHaveBeenCalledTimes(3);
    });
});

// ===========================================================================
// ENF-04: Error TTL -- transition from ERROR to INVALID after 24h
// ===========================================================================
describe('Error TTL - ENF-04', () => {
    test('ERROR state with lastSuccessfulCheck < 24h ago stays ERROR', async () => {
        // First validate successfully so lastSuccessfulCheck is set
        const successResponse = makeSignedResponse(true, '2027-01-01T00:00:00.000Z', licenseConfig.hmacSecret);
        mockAxiosGet.mockResolvedValueOnce({ data: successResponse });
        await validate();
        expect(getStatus().state).toBe('VALID');

        // Now simulate a network failure -- lastSuccessfulCheck is recent (< 24h)
        mockAxiosGet.mockRejectedValueOnce(new Error('Server unreachable'));
        const result = await validate();

        // Should be ERROR because last success was just now (< 24h ago)
        expect(result.state).toBe('ERROR');
    });

    test('ERROR state with lastSuccessfulCheck > 24h ago transitions to INVALID', async () => {
        jest.useFakeTimers();

        // Set lastSuccessfulCheck to 25 hours ago by manipulating Date.now
        const now = Date.now();
        const twentyFiveHoursAgo = now - (25 * 60 * 60 * 1000);

        // First: set a fake successful check 25h ago
        jest.setSystemTime(twentyFiveHoursAgo);
        const successResponse = makeSignedResponse(true, '2027-01-01T00:00:00.000Z', licenseConfig.hmacSecret, twentyFiveHoursAgo);
        mockAxiosGet.mockResolvedValueOnce({ data: successResponse });
        await validate();

        // Advance time to "now" (25h later)
        jest.setSystemTime(now);

        // Now a network failure should cause _checkErrorTTL to fire with > 24h elapsed
        mockAxiosGet.mockRejectedValueOnce(new Error('Server unreachable'));
        const result = await validate();

        // Should transition to INVALID because 25h have passed since last successful check
        expect(result.state).toBe('INVALID');
    });
});
