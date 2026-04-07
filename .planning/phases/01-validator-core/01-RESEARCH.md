# Phase 1: Validator Core - Research

**Researched:** 2026-04-07
**Domain:** License validation service — Node.js, HMAC-SHA256, DNS bypass detection, three-state cache, startup gating
**Confidence:** HIGH (primary source is the reference implementation running in production)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- ALL three entry points must be gated: main.js (Express+cron), app.js (sync-only), sync.js (direct execution)
- No way to run SageSync without a valid license — full lockdown
- App exits with code 1 if license validation fails after 3 retries at startup
- Validate that ALL critical env vars exist before the app attempts to start — not just license vars
- If any required env var is missing, fail immediately with a clear error message listing what's missing
- License-specific vars: LICENSE_API_URL, HMAC_SECRET, SAGESYNC_API_KEY
- Port LicenseValidator.js from sageconnect and adapt (do NOT rewrite from scratch)
- Swap sageconnect's LogGenerator → SageSync's Winston logger
- Swap sageconnect's flat config.js references → SageSync config structure
- Remove email alert logic (nodemailer not needed)
- Preserve all security logic verbatim: HMAC verification, timestamp freshness, DNS check, three-state cache, 24h ERROR→INVALID TTL
- Environment variable: SAGESYNC_API_KEY (mirrors SAGECONNECT_API_KEY pattern)
- Register as new client on existing sageconnect-license.vercel.app

### Claude's Discretion

- Whether license config goes in config/server.js or a new config/license.js
- Exact structure of the env var validation (order, grouping, error format)
- Whether to add a shared validate-env utility or inline in each entry point

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CFG-01 | License configured via environment variables (LICENSE_API_URL, HMAC_SECRET, SAGESYNC_API_KEY) | Reference implementation's `config.license` block shows exact shape; new config module follows server.js pattern |
| CFG-02 | DNS bypass detection logs warning when license server resolves to private/loopback IP | Reference `_checkDns()` + `_isPrivateOrLoopback()` functions are verbatim portable |
| LIC-01 | App validates license against remote server on startup (3 retries with exponential backoff) | Reference `validate({startup:true})` + retry loop is verbatim portable; only `config.license.apiUrl` and `config.security.apiKey` refs change |
| LIC-02 | App validates license periodically on each cron sync cycle | Reference `validate()` (no options) can be called at the top of each cron callback; already done in sageconnect's cron |
| LIC-03 | License response verified via HMAC-SHA256 signature with shared secret | Reference `verifySignature()` is verbatim portable — uses Node built-in `crypto` only |
| LIC-04 | Timestamp freshness check rejects responses older than 5 minutes | Reference `checkTimestampFreshness()` is verbatim portable |
| ENF-03 | App exits with code 1 if license validation fails at startup after retries | Handled inside `validate({startup:true})` — calls `process.exit(1)` after exhausted retries |
| ENF-04 | Three-state cache model (VALID/INVALID/ERROR) with 24h ERROR→INVALID TTL | Reference `cachedState` + `_checkErrorTTL()` are verbatim portable |
</phase_requirements>

---

## Summary

This phase is a port, not a greenfield build. The reference implementation (`sageconnect/src/services/LicenseValidator.js`) is 306 lines of production-proven code. Every security-critical function — HMAC verification, timestamp freshness, DNS bypass detection, three-state cache, 24h ERROR TTL, exponential-backoff retry — can be copied verbatim with only two categories of changes: (1) swap `logGenerator(LOG_FILE, level, msg)` calls to `logger.level(msg)`, and (2) swap `config.license.*` / `config.security.apiKey` references to the SageSync config shape.

The additional SageSync-specific work is: (a) creating a license config module (`src/config/license.js`) that adds `LICENSE_API_URL`, `HMAC_SECRET`, and `SAGESYNC_API_KEY` to the env var load in the same pattern as `src/config/server.js`; (b) adding an env var validation function that checks ALL critical vars before startup, modeled after sageconnect's `config.js` `validate()` function; and (c) wiring the `validate({startup:true})` call as an `async` gate at the top of all three entry points (`main.js`, `app.js`, `sync.js`).

No new runtime dependencies are needed. `axios` and `crypto` (built-in) are already present. The email alert block (`sendLicenseAlert`) is dropped entirely — zero dead code.

**Primary recommendation:** Create `src/services/LicenseValidator.js` by copying the reference and doing a targeted substitution pass. Create `src/config/license.js` for the license env block. Add a shared `src/utils/validateEnv.js` that collects ALL missing required vars and exits with a clear list. Wire all three entry points.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `crypto` | Node built-in | HMAC-SHA256 signing + constant-time compare | Already used in reference; zero install cost |
| `dns` | Node built-in | DNS bypass detection via `resolve4()` | Already used in reference; bypasses OS hosts file unlike `dns.lookup()` |
| `axios` | ^1.6.0 | HTTP calls to license server | Already in `package.json`; reference uses it |
| `dotenv` | ^16.3.1 | Env var loading | Already in `package.json`; already called in `server.js` |
| `winston` | ^3.11.0 | Logging | Already in `package.json`; `src/config/logger.js` is the singleton to use |

### No New Dependencies Required

All runtime requirements are already satisfied by the existing `package.json`. Do NOT install `nodemailer`.

## Architecture Patterns

### File Layout for this Phase
```
src/
├── config/
│   ├── server.js          # existing — add nothing here (keep clean)
│   ├── license.js          # NEW — license env vars + validateLicenseEnv()
│   └── logger.js           # existing — use as-is
├── services/
│   └── LicenseValidator.js # NEW — ported from sageconnect
├── utils/
│   └── validateEnv.js      # NEW — collects all critical missing vars, exits(1) with list
├── main.js                 # MODIFY — add license gate at top of startup
├── app.js                  # MODIFY — add license gate before cron.schedule
└── sync.js                 # MODIFY — add license gate before runSync()
```

### Pattern 1: License Config Module (`src/config/license.js`)

**What:** Mirrors the shape of `src/config/server.js` but for license-specific env vars. Returns a plain object consumed by `LicenseValidator.js`.

**When to use:** All license config access goes through this module — LicenseValidator imports it instead of `config/server.js`.

```javascript
// src/config/license.js
require('dotenv').config();

module.exports = {
    apiUrl: process.env.LICENSE_API_URL || '',
    hmacSecret: process.env.HMAC_SECRET || '',
    apiKey: process.env.SAGESYNC_API_KEY || '',
};
```

### Pattern 2: Shared Env Validation (`src/utils/validateEnv.js`)

**What:** One place that knows every required env var. Groups them by domain. Collects ALL missing vars before exiting, not just the first. Call this as the very first thing in each entry point before any `require()` of services.

**When to use:** Top of `main.js`, `app.js`, and `sync.js` — before any service initialization.

```javascript
// src/utils/validateEnv.js
require('dotenv').config();

const REQUIRED_VARS = {
    license: ['LICENSE_API_URL', 'HMAC_SECRET', 'SAGESYNC_API_KEY'],
    sage: ['DB_USER', 'DB_PASSWORD', 'DB_SERVER', 'DB_NAME'],   // adjust to actual SageSync env vars
    fracttal: ['FRACTTAL_API_URL', 'FRACTTAL_API_KEY'],          // adjust to actual SageSync env vars
};

function validateEnv() {
    const missing = [];
    for (const [group, vars] of Object.entries(REQUIRED_VARS)) {
        for (const v of vars) {
            if (!(process.env[v] || '').trim()) {
                missing.push(`  - ${v} (${group})`);
            }
        }
    }
    if (missing.length > 0) {
        console.error(
            '[ENV ERROR] Missing required environment variables:\n' +
            missing.join('\n') + '\n' +
            'Add them to .env and restart.'
        );
        process.exit(1);
    }
}

module.exports = { validateEnv };
```

**IMPORTANT:** The list of non-license required vars (`sage`, `fracttal`) must be confirmed by reviewing the current SageSync `.env` and service constructors. The example above is a placeholder structure.

### Pattern 3: LicenseValidator Port (`src/services/LicenseValidator.js`)

**What:** Copy of the reference with two mechanical substitutions applied.

**Substitution map:**

| Remove (sageconnect) | Replace with (SageSync) |
|----------------------|------------------------|
| `const config = require('../config');` | `const licenseConfig = require('../config/license');` |
| `const { logGenerator } = require('../utils/LogGenerator');` | `const logger = require('../config/logger');` |
| `logGenerator(LOG_FILE, 'info', msg)` | `logger.info(msg)` |
| `logGenerator(LOG_FILE, 'warn', msg)` | `logger.warn(msg)` |
| `logGenerator(LOG_FILE, 'error', msg)` | `logger.error(msg)` |
| `config.license.apiUrl` | `licenseConfig.apiUrl` |
| `config.license.hmacSecret` | `licenseConfig.hmacSecret` |
| `config.security.apiKey` | `licenseConfig.apiKey` |
| `sendLicenseAlert(...)` (entire function + all calls) | Delete — no replacement |
| `console.warn(...)` / `console.error(...)` in license flow | Keep or remove (Winston already logs to console in non-prod) |

**What stays verbatim (do not change):**
- `verifySignature()` — entire function
- `checkTimestampFreshness()` — entire function
- `_isPrivateOrLoopback()` — entire function
- `_checkDns()` — entire function
- `_checkErrorTTL()` — entire function
- `_doValidate()` — logic unchanged, only config/logger refs swapped
- `validate()` — logic unchanged, `sendLicenseAlert` calls removed
- `cachedState` object shape
- All constants (FRESHNESS_WINDOW_MS, ERROR_TTL_MS, etc.)
- `isValid()`, `getStatus()`, `_reset()` — unchanged
- `module.exports` — unchanged

### Pattern 4: Entry Point Gating

**What:** Each entry point calls `validate({startup:true})` before doing anything else. `main.js` is async already (it can be wrapped). `app.js` already uses async at module level indirectly via cron. `sync.js` already has an async `runSync()`.

**main.js gate pattern:**
```javascript
// At very top of main.js, before app.listen()
const { validateEnv } = require('./utils/validateEnv');
const { validate: validateLicense } = require('./services/LicenseValidator');

validateEnv(); // sync, exits immediately if vars missing

async function startServer() {
    await validateLicense({ startup: true }); // exits with code 1 if license fails after retries
    // ... rest of main.js startup (app.listen, cron.schedule, etc.)
}

startServer().catch((err) => {
    logger.error('Fatal startup error:', err);
    process.exit(1);
});
```

**app.js gate pattern:**
```javascript
// app.js — wrap entire startup in async IIFE or named async function
const { validateEnv } = require('./utils/validateEnv');
const { validate: validateLicense } = require('./services/LicenseValidator');

validateEnv();

async function start() {
    await validateLicense({ startup: true });
    // existing cron.schedule() call and syncInventory() definition go here
}

start().catch((err) => {
    logger.error('Fatal startup error:', err);
    process.exit(1);
});
```

**sync.js gate pattern:**
```javascript
// sync.js already has async runSync() — add gate at top of runSync()
const { validateEnv } = require('./utils/validateEnv');
const { validate: validateLicense } = require('./services/LicenseValidator');

async function runSync() {
    validateEnv();
    await validateLicense({ startup: true });
    // existing sync logic...
}
```

### Anti-Patterns to Avoid

- **Calling `validate()` without `{startup:true}` at startup:** Without this flag, failures are silently cached as ERROR state instead of exiting the process. Always pass `{startup:true}` in entry points.
- **Calling `validateEnv()` after service constructors:** `SageService` and `FracttalClient` constructors may try to access env vars. Run `validateEnv()` FIRST, before instantiating any service.
- **Importing `LicenseValidator` at module scope without gating:** The singleton's `cachedState` starts as UNKNOWN. Nothing blocks until `validate()` is called. The gate MUST be awaited.
- **Using `dns.lookup()` instead of `dns.resolve4()`:** `dns.lookup()` uses the OS resolver and is bypassed by `/etc/hosts` manipulation. The reference correctly uses `dns.resolve4()`. Do not change this.
- **Changing payload field order in `verifySignature()`:** The HMAC payload is constructed with explicit field ordering to match the server. Changing the order breaks all verification. Copy verbatim.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HMAC constant-time comparison | Custom string equality | `crypto.timingSafeEqual()` | Prevents timing attacks — already in reference |
| HTTP retry with backoff | Custom retry loop | The reference's `validate()` loop | Already handles 3 retries at 1s/2s/4s |
| DNS bypass detection | Port scanner / IP validator | Reference `_checkDns()` + `_isPrivateOrLoopback()` | Covers all RFC 1918 + loopback ranges correctly |
| State machine (VALID/INVALID/ERROR) | Custom flag variables | Reference `cachedState` singleton | Handles ERROR→INVALID TTL transition correctly |
| Env var validation | Manual `if (!process.env.X)` scattered in code | Centralized `validateEnv()` util | One place to maintain the full required-vars list |

**Key insight:** Every security primitive in this phase has a subtle correctness requirement. Copy the reference implementation rather than reasoning from scratch.

---

## Common Pitfalls

### Pitfall 1: `main.js` is not async at module scope
**What goes wrong:** `main.js` calls `app.listen()` at module scope (not inside an async function). You cannot `await validateLicense()` at module scope without wrapping.
**Why it happens:** The original `main.js` was written synchronously.
**How to avoid:** Wrap the entire startup sequence in a named `async function startServer()` and call it. This is the cleanest pattern (see Pattern 4 above).
**Warning signs:** Top-level `await` syntax error in Node < 14, or license gate running fire-and-forget.

### Pitfall 2: `app.js` exports `syncInventory` which `sync.js` imports
**What goes wrong:** `sync.js` does `const { syncInventory } = require('./app')`. If the license gate is added to `sync.js`'s `runSync()`, but `app.js` module-scope code also runs at `require()` time (cron scheduling), the gate in `sync.js` may fire after `app.js` already scheduled work.
**Why it happens:** Node.js `require()` executes the module. `app.js` has `cron.schedule()` at module scope.
**How to avoid:** Gate `app.js` at module scope too (wrapping its startup in an async IIFE). The gate in `app.js` ensures it never schedules work without a valid license. The gate in `sync.js` provides an additional check for direct execution.
**Warning signs:** Cron schedules fire before license check completes.

### Pitfall 3: `SAGESYNC_API_KEY` vs `SAGECONNECT_API_KEY` naming
**What goes wrong:** Copy-paste of the URL template from the reference uses `config.security.apiKey` which in sageconnect maps to `SAGECONNECT_API_KEY`. SageSync uses `SAGESYNC_API_KEY`.
**Why it happens:** Reference code reads `process.env.SAGECONNECT_API_KEY`. The port renames it.
**How to avoid:** The `license.js` config module maps `process.env.SAGESYNC_API_KEY` → `licenseConfig.apiKey`. LicenseValidator uses `licenseConfig.apiKey`. No hard-coded env var name inside LicenseValidator itself.
**Warning signs:** License validation returns 401 or 403 from the server.

### Pitfall 4: Missing `lastSuccessfulCheck` on first ERROR
**What goes wrong:** If the very first validation call returns ERROR (network down), `lastSuccessfulCheck` is null. `_checkErrorTTL()` skips the TTL check when `lastSuccessfulCheck` is null, so the state stays ERROR indefinitely on first boot — this is the CORRECT behavior, but it means the startup retry loop is the real gate, not the TTL.
**Why it happens:** By design in the reference. On first boot with no prior success, ERROR means the service should exit (via startup retry exhaustion), not wait 24h.
**How to avoid:** This is correct behavior — do not change it. Ensure `{startup:true}` is always passed on startup so the retry+exit logic fires.

### Pitfall 5: Winston logger mock in tests
**What goes wrong:** Tests that import `LicenseValidator` will trigger logger calls. Without mocking, these write to log files during test runs (or fail if log directory doesn't exist in CI).
**Why it happens:** `logger.js` creates the log directory and file transports at import time.
**How to avoid:** `tests/setup.js` already mocks `../src/config/logger`. Any new test file for `LicenseValidator` must also mock `../src/config/logger` (or rely on the global `setupFilesAfterEnv` mock in `tests/setup.js`).

---

## Code Examples

### HMAC Verification (verbatim from reference — do not modify)
```javascript
// Source: sageconnect/src/services/LicenseValidator.js lines 71-93
function verifySignature(responseData, hmacSecret) {
    if (!responseData || !responseData.sig) return false;

    const payload = { active: responseData.active };
    if (responseData.active === true && responseData.expiresAt !== undefined) {
        payload.expiresAt = responseData.expiresAt;
    }
    payload.ts = responseData.ts;

    const expected = crypto
        .createHmac('sha256', hmacSecret)
        .update(JSON.stringify(payload), 'utf-8')
        .digest('hex');

    const expectedBuf = Buffer.from(expected, 'utf8');
    const sigBuf = Buffer.from(String(responseData.sig), 'utf8');
    if (expectedBuf.length !== sigBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, sigBuf);
}
```

### Winston Logger Call Replacement
```javascript
// Before (sageconnect):
logGenerator(LOG_FILE, 'info', '[LICENSE] License VALID. Expires: ' + cachedState.expiresAt);

// After (SageSync):
logger.info('[LICENSE] License VALID. Expires: ' + cachedState.expiresAt);
```

### URL Construction Change
```javascript
// Before (sageconnect):
var url = config.license.apiUrl + '/api/validate?key=' + config.security.apiKey;

// After (SageSync):
const url = licenseConfig.apiUrl + '/api/validate?key=' + licenseConfig.apiKey;
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Inline env validation in each entry point | Centralized `validateEnv()` utility | This phase (new pattern) | Single source of truth; easy to extend as new vars are added |
| sageconnect flat `config.js` with all sections | SageSync split: `server.js` (runtime), `configManager.js` (business), new `license.js` (license) | This phase | Keeps license config isolated; doesn't pollute `server.js` |

---

## Open Questions

1. **What are ALL the critical env vars for SageSync (non-license)?**
   - What we know: `server.js` has `PORT`, `SYNC_CRON_SCHEDULE`, `SYNC_ON_STARTUP`, `LOG_*` vars. `SageService` and `FracttalClient` constructors access additional vars.
   - What's unclear: The exact required-vars list for `validateEnv()`. `SageService` reads `DB_*` vars; `FracttalClient` reads `FRACTTAL_*` vars — exact names need confirmation from those files.
   - Recommendation: Read `src/services/sageService.js` and `src/services/fracttalClient.js` constructors during planning/implementation to build the complete `REQUIRED_VARS` list for `validateEnv.js`.

2. **Does `sageconnect-license.vercel.app` already have a SageSync client key?**
   - What we know: BLOCKERS note says "Need new SAGESYNC_API_KEY registered on the license server before Phase 1 can be tested end-to-end."
   - What's unclear: Whether to block implementation or proceed and test with a placeholder key.
   - Recommendation: Implementation can proceed with any placeholder key value; the validator logic is testable end-to-end with a mocked license server. Real key needed only for production deployment.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest 29.7.0 |
| Config file | `jest.config.js` (project root) |
| Quick run command | `npx jest tests/services/LicenseValidator.test.js --no-coverage` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CFG-01 | `licenseConfig` exports correct values from env vars | unit | `npx jest tests/services/LicenseValidator.test.js -t "config"` | ❌ Wave 0 |
| CFG-02 | `_checkDns()` warns on private/loopback IP, not on public IP | unit | `npx jest tests/services/LicenseValidator.test.js -t "dns"` | ❌ Wave 0 |
| LIC-01 | `validate({startup:true})` retries 3 times with backoff then exits | unit | `npx jest tests/services/LicenseValidator.test.js -t "startup"` | ❌ Wave 0 |
| LIC-02 | `validate()` without startup flag returns result without exiting | unit | `npx jest tests/services/LicenseValidator.test.js -t "periodic"` | ❌ Wave 0 |
| LIC-03 | `verifySignature()` returns false on tampered payload | unit | `npx jest tests/services/LicenseValidator.test.js -t "hmac"` | ❌ Wave 0 |
| LIC-04 | `checkTimestampFreshness()` rejects stale and future timestamps | unit | `npx jest tests/services/LicenseValidator.test.js -t "timestamp"` | ❌ Wave 0 |
| ENF-03 | `validate({startup:true})` calls `process.exit(1)` after exhausted retries | unit | `npx jest tests/services/LicenseValidator.test.js -t "exit"` | ❌ Wave 0 |
| ENF-04 | ERROR state after 24h transitions to INVALID | unit | `npx jest tests/services/LicenseValidator.test.js -t "error ttl"` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx jest tests/services/LicenseValidator.test.js --no-coverage`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/services/LicenseValidator.test.js` — covers all 8 requirements above
  - Must mock: `axios`, `dns`, `../src/config/license`, `../src/config/logger`, `process.exit`
  - Global setup in `tests/setup.js` already mocks logger — test file still needs `jest.spyOn(process, 'exit')` for ENF-03

*(No framework install needed — Jest already installed and configured)*

---

## Sources

### Primary (HIGH confidence)
- `/Users/freptar0/Desktop/Tersoft/integraciones/sageconnect/src/services/LicenseValidator.js` — complete reference implementation, read in full
- `/Users/freptar0/Desktop/Tersoft/integraciones/sageconnect/src/config.js` — reference config shape and env var patterns
- `/Users/freptar0/Desktop/Tersoft/integraciones/SageSync/src/config/logger.js` — Winston singleton to substitute for LogGenerator
- `/Users/freptar0/Desktop/Tersoft/integraciones/SageSync/src/config/server.js` — existing config pattern to mirror
- `/Users/freptar0/Desktop/Tersoft/integraciones/SageSync/src/config/configManager.js` — existing validation pattern
- `/Users/freptar0/Desktop/Tersoft/integraciones/SageSync/src/main.js` — entry point to gate (line 61: `app.listen()`)
- `/Users/freptar0/Desktop/Tersoft/integraciones/SageSync/src/app.js` — entry point to gate (line 174: `cron.schedule()`)
- `/Users/freptar0/Desktop/Tersoft/integraciones/SageSync/src/sync.js` — entry point to gate (imports from app.js)
- `/Users/freptar0/Desktop/Tersoft/integraciones/SageSync/package.json` — confirms all required deps already present
- `/Users/freptar0/Desktop/Tersoft/integraciones/SageSync/jest.config.js` — confirmed test framework config
- `/Users/freptar0/Desktop/Tersoft/integraciones/SageSync/tests/setup.js` — confirmed global logger mock pattern

### Secondary (MEDIUM confidence)
- `.planning/phases/01-validator-core/01-CONTEXT.md` — locked decisions and adaptation scope
- `.planning/REQUIREMENTS.md` — requirement definitions for CFG-01 through ENF-04

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all dependencies already in package.json; verified by direct file read
- Architecture: HIGH — based on direct read of reference implementation and all target files
- Pitfalls: HIGH — derived from actual code structure (app.js sync relationship, main.js non-async shape)
- Test map: HIGH — Jest config verified; test file gaps are factual (none exist yet)

**Research date:** 2026-04-07
**Valid until:** 2026-05-07 (stable domain — no fast-moving external APIs involved)
