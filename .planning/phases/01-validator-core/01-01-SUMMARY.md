---
phase: 01-validator-core
plan: "01"
subsystem: auth
tags: [license, hmac, sha256, axios, winston, dns]

# Dependency graph
requires: []
provides:
  - "src/config/license.js: reads LICENSE_API_URL, HMAC_SECRET, SAGESYNC_API_KEY from env"
  - "src/utils/validateEnv.js: validates all critical env vars (license + database + fracttal) at startup"
  - "src/services/LicenseValidator.js: HMAC-signed license validation singleton with three-state cache and startup retry"
affects:
  - 01-validator-core
  - 02-enforcement

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Config module pattern: require('dotenv').config() + module.exports object (mirroring src/config/server.js)"
    - "License validation singleton: module-level cachedState + validate()/isValid()/getStatus()/_reset() exports"
    - "HMAC-SHA256 with constant-time comparison (crypto.timingSafeEqual) for signature verification"
    - "DNS defense-in-depth: dns.resolve4() to bypass OS hosts file, warn-only (HMAC is primary gate)"

key-files:
  created:
    - src/config/license.js
    - src/utils/validateEnv.js
    - src/services/LicenseValidator.js
  modified: []

key-decisions:
  - "Removed sendLicenseAlert and nodemailer entirely — log warnings only per user decision"
  - "validateEnv checks all three groups (license, database, fracttal) — fail-fast with complete error list"
  - "LicenseValidator uses Winston logger singleton (not LogGenerator) — consistent with SageSync logging"

patterns-established:
  - "Config pattern: require('dotenv').config() at top, module.exports plain object"
  - "Env validator: collect ALL missing vars before exiting, grouped error output with domain labels"
  - "License singleton: three-state cache (VALID/INVALID/ERROR/UNKNOWN), 24h ERROR TTL, startup retries"

requirements-completed: [CFG-01, CFG-02, LIC-01, LIC-02, LIC-03, LIC-04, ENF-03, ENF-04]

# Metrics
duration: 3min
completed: 2026-04-07
---

# Phase 1 Plan 01: Validator Core Summary

**HMAC-SHA256 license validator singleton ported from sageconnect with three-state cache, DNS defense, startup retry, and Winston logger replacing LogGenerator**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-04-07T22:10:39Z
- **Completed:** 2026-04-07T22:13:19Z
- **Tasks:** 2
- **Files modified:** 3 created

## Accomplishments

- License config module reads LICENSE_API_URL, HMAC_SECRET, SAGESYNC_API_KEY from environment
- Centralized env validator checks all critical vars (license, database, fracttal) and exits with formatted error listing all missing vars
- LicenseValidator ported from sageconnect: HMAC-SHA256 with timingSafeEqual, 5-minute timestamp freshness window, DNS bypass detection via dns.resolve4(), three-state cache (VALID/INVALID/ERROR) with 24h ERROR TTL, startup retry (3 attempts at 1s/2s/4s backoff then process.exit(1))

## Task Commits

Each task was committed atomically:

1. **Task 1: Create license config module and env validator** - `15bc0e3` (feat)
2. **Task 2: Port LicenseValidator from sageconnect** - `c3ad963` (feat)

**Plan metadata:** (docs commit below)

## Files Created/Modified

- `src/config/license.js` - Exports apiUrl, hmacSecret, apiKey from environment variables
- `src/utils/validateEnv.js` - Validates all critical env vars across license/database/fracttal groups, exits with code 1 on missing vars
- `src/services/LicenseValidator.js` - License validation singleton with HMAC-SHA256, timestamp freshness, DNS check, three-state cache, 24h ERROR TTL, startup retry logic

## Decisions Made

- Removed `sendLicenseAlert` function and all call sites — no nodemailer dependency in SageSync (user decision: log warnings only)
- `validateEnv` validates all three env var groups at once (not just license) to fail fast with a complete error list on startup
- Duplicate `console.warn`/`console.error` calls removed — Winston already outputs to console in non-production environments

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

Before the license validator can be tested end-to-end, add these to `.env`:
- `LICENSE_API_URL` — URL of the license server (e.g., `https://sageconnect-license.vercel.app`)
- `HMAC_SECRET` — shared HMAC secret registered on the license server for SageSync
- `SAGESYNC_API_KEY` — client API key registered on the license server

See STATE.md blocker: "Need new SAGESYNC_API_KEY registered on the license server before Phase 1 can be tested end-to-end"

## Next Phase Readiness

- License config, env validator, and LicenseValidator service are complete and verified
- Ready for Phase 1 Plan 02: wire LicenseValidator into app startup and periodic cron checks
- Blocker: SAGESYNC_API_KEY needed for end-to-end license server testing (does not block wiring work)

---
*Phase: 01-validator-core*
*Completed: 2026-04-07*
