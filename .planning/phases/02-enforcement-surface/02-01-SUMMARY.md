---
phase: 02-enforcement-surface
plan: 01
subsystem: api
tags: [express, middleware, license, enforcement, supertest, jest]

# Dependency graph
requires:
  - phase: 01-validator-core
    provides: LicenseValidator service with isValid(), getStatus(), _reset() exports
provides:
  - requireLicense Express middleware blocking all non-exempt routes when license invalid
  - GET /api/system/license status endpoint (always accessible, returns 6 fields)
  - License gate mounted before express.static in main.js (blocks HTML serving too)
  - Cron guard log level fixed from error to warn
affects:
  - Any phase adding new routes (all routes are automatically gated)
  - Dashboard serving (blocked when license invalid)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "License exemption via wrapper: app.use((req,res,next) => { if exempt, skip requireLicense })"
    - "requireLicense calls isValid() synchronously — no async, no HTTP in middleware"
    - "Integration tests mock src/app to prevent validateEnv() side-effect at module load"

key-files:
  created:
    - src/middleware/requireLicense.js
    - tests/middleware/requireLicense.test.js
    - tests/integration/licenseEnforcement.test.js
  modified:
    - src/routes/systemRoutes.js
    - src/main.js

key-decisions:
  - "requireLicense exemption handled in main.js wrapper (not inside middleware) so middleware stays single-responsibility"
  - "src/app mock added to integration test to prevent validateEnv() process.exit() at module load (syncController requires app.js)"
  - "requireLicense mounted inside startServer() function with require() to keep middleware co-located with its placement rationale"

patterns-established:
  - "Express middleware ordering: express.json -> requireLicense wrapper -> express.static -> routes -> errorHandler"
  - "License status endpoint always returns 200 regardless of state — client can always diagnose license issues"

requirements-completed: [ENF-01, ENF-02, STS-01]

# Metrics
duration: 3min
completed: 2026-04-08
---

# Phase 02 Plan 01: Enforcement Surface Summary

**Express middleware gate returning HTTP 503+state on all routes except /api/system/license, mounted before express.static with 16 passing tests (7 unit + 9 integration)**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-08T04:17:39Z
- **Completed:** 2026-04-08T04:21:10Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- requireLicense middleware: synchronously checks isValid(), returns 503+{error, state} when invalid, next() when valid
- GET /api/system/license route: returns all 6 fields (state, active, expiresAt, lastChecked, lastSuccessfulCheck, hmacConfigured) regardless of license state
- main.js updated: requireLicense mounted BEFORE express.static with /api/system/license exemption, cron guard changed from logger.error to logger.warn
- Full TDD cycle: RED (tests failed, module not found) → GREEN (all 16 pass)

## Task Commits

1. **Task 1: Create requireLicense middleware and license status route** - `d4ede38` (feat)
2. **Task 2: Mount middleware in main.js and fix cron log level** - `fd219e9` (feat)

**Plan metadata:** (final docs commit — see below)

## Files Created/Modified

- `src/middleware/requireLicense.js` - Express middleware, 503 on invalid license, next() on valid
- `src/routes/systemRoutes.js` - Added GET /system/license route (becomes /api/system/license)
- `src/main.js` - Mounted requireLicense before express.static; changed cron logger.error to logger.warn
- `tests/middleware/requireLicense.test.js` - 7 unit tests covering all middleware behaviors
- `tests/integration/licenseEnforcement.test.js` - 9 integration tests for ENF-01 and STS-01

## Decisions Made

- requireLicense exemption is handled in the main.js wrapper (`if path === /api/system/license`) rather than inside the middleware itself — keeps middleware single-responsibility and testable without exemption logic
- Added `jest.mock('../../src/app', ...)` to integration test — syncController requires app.js which calls validateEnv() at module load time, which calls process.exit(1) when env vars are missing in test environment

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added mock for src/app in integration test**
- **Found during:** Task 1 (integration test execution)
- **Issue:** `src/routes/index.js` requires `syncRoutes` which requires `syncController` which requires `src/app` which calls `validateEnv()` at module load — `process.exit(1)` killed the Jest worker (4 crashes, retry limit exceeded)
- **Fix:** Added `jest.mock('../../src/app', () => ({ syncInventory: jest.fn() }))` to the integration test mocks block
- **Files modified:** `tests/integration/licenseEnforcement.test.js`
- **Verification:** Integration test suite runs and all 9 tests pass
- **Committed in:** `d4ede38` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Required fix for test environment — no scope creep, no production code changes.

## Issues Encountered

- Pre-existing test failure in `tests/services/fracttalClient.test.js` (`updateWarehouseItem` expects PUT `/items/item1` but implementation calls `/inventories_adjustment/item1`). Confirmed pre-existing via git stash verification. Logged to `deferred-items.md`, not fixed.

## Next Phase Readiness

- All ENF-01, ENF-02, STS-01 requirements satisfied
- License enforcement now covers all HTTP paths including static file serving
- Any future routes added to the Express app are automatically gated by requireLicense
- No blockers for further phases

---
*Phase: 02-enforcement-surface*
*Completed: 2026-04-08*
