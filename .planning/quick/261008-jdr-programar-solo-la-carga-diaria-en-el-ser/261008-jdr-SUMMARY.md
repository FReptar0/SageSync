---
phase: quick-261008-jdr
plan: 01
subsystem: sync-scheduling
tags: [node-cron, timezone, scheduler, license-gate, jest, headless]

# Dependency graph
requires:
  - phase: v1.1 License Control System
    provides: LicenseValidator validate()/isValid() (periodic re-validation reused by every scheduled tick)
  - phase: feat/fracttal-carga-diaria-delta
    provides: syncInventoryMoved() + sageService.getMovedInventoryItems() (the daily/delta load now scheduled)
provides:
  - SYNC_DAILY_CRON_SCHEDULE (daily/delta load cron), SYNC_CRON_SCHEDULE=off toggle, SYNC_TIMEZONE (default America/Mexico_City)
  - src/config/schedules.js pure resolver/describer with boot-time fail-fast in main.js and headless app.js
  - src/services/syncScheduler.js (one cron per enabled load, explicit timezone, license + in-progress guarded ticks)
  - runSyncWithTracking(sm, { mode }) with mode recorded in sync history
  - side-effect-free require of src/app.js; headless runs never overlap
affects: [deployment .env, RUNBOOK operations, license-guard audits, dashboard sync history]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure config resolver returns { values..., errors[] }; entry points print Spanish errors with console.error and exit 1 before any cron.schedule"
    - "Every cron.schedule passes { timezone } explicitly (never relies on the Windows server zone)"
    - "Entry-point side effects guarded by require.main === module; test-only alias export (_startHeadless)"
    - "jest.isolateModules + module-scope mock* objects for modules with load-time state"

key-files:
  created:
    - src/config/schedules.js
    - src/services/syncScheduler.js
    - tests/config/schedules.test.js
    - tests/services/syncScheduler.test.js
    - tests/controllers/syncController.test.js
    - tests/integration/appHeadless.test.js
  modified:
    - src/config/server.js
    - src/controllers/syncController.js
    - src/services/syncStateManager.js
    - src/main.js
    - src/app.js
    - docs/DEPLOYMENT.md
    - HANDOFF.md
    - RUNBOOK.md
    - ARCHITECTURE.md

key-decisions:
  - "Service schedules only the daily/delta load in production (SYNC_CRON_SCHEDULE=off + SYNC_DAILY_CRON_SCHEDULE='0 12,16,23 * * *'); full load is manual (dashboard POST /api/sync or npm run sync)"
  - "SYNC_TIMEZONE (default America/Mexico_City) is applied to every cron.schedule in both entry points (GitHub #3)"
  - "Invalid SYNC_* schedule values abort boot (exit 1) with a Spanish message naming the variable; an invalid cron is no longer a way to disable scheduling"
  - "Requiring src/app.js no longer starts headless mode (removes the extra unguarded 02:00 full-load cron under the service); headless runs guarded by a module-level flag (GitHub #9)"
  - "manualSync catches its background run so a failed manual full load cannot crash the service with an unhandled rejection"

patterns-established:
  - "Schedule resolution: normalize (trim + collapse whitespace), off-values off/false/none/disabled, collect all errors in one pass"
  - "Scheduler module must never be required from src/app.js (require cycle app -> syncScheduler -> syncController -> app)"

requirements-completed: [quick-261008-jdr, GH-3, GH-9]

# Metrics
duration: 14min
completed: 2026-10-08
---

# Quick Task 261008-jdr: Schedule only the daily load (12/16/23 Mexico time), full load manual

**The service now registers one cron per enabled load type, always with an explicit IANA timezone. The production recipe schedules only `syncInventoryMoved` at 12:00, 16:00 and 23:00 America/Mexico_City. Invalid schedule values stop boot, and requiring `src/app.js` no longer registers a hidden extra full-load cron.**

## Performance

- **Duration:** 14 min
- **Started:** 2026-10-08T20:38:09Z
- **Completed:** 2026-10-08T20:52:23Z
- **Tasks:** 3/3
- **Files modified:** 15 (6 created, 9 modified)

## Accomplishments

- The production recipe (`SYNC_CRON_SCHEDULE=off`, `SYNC_DAILY_CRON_SCHEDULE=0 12,16,23 * * *`) makes `node src/main.js` register exactly one cron (the daily/delta load) with `{ timezone: 'America/Mexico_City' }`. Confirmed with the real node-cron: `tasks registered: 1 | node-cron storage size: 1`.
- Each scheduled tick re-validates the license (periodic `validate()`), then skips if the license is invalid (`License invalid — skipping scheduled sync (<label>)`, a prefix `/log-tail` searches for) or if a sync is already in progress. Otherwise it calls `runSyncWithTracking(sm, { mode })`.
- Sync history entries record `mode: 'full' | 'daily'`. The dashboard shows `Completa: sin horario (manual) · Diaria: 0 12,16,23 * * * · Zona: America/Mexico_City`.
- Fixed a latent bug: `start()` in `src/app.js` ran at module load, so every process that required it (main.js through syncController, sync.js) ran a second startup license gate and registered an extra, unguarded `0 2 * * *` full-load cron. Under the service this meant a double 02:00 full run.
- Headless mode (`npm run sync-only`) now validates the schedules, uses the timezone, honors `off`, and never overlaps runs (GitHub #9).
- `manualSync`'s background promise is now caught, so a failed manual full load cannot abort Node 18 with an unhandled rejection (orchestrator amendment).

## Task Commits

1. **Task 1: Schedule resolver + scheduler service + mode-aware tracking, wired into main.js**: `c7522c2` (feat)
2. **Task 2: app.js does nothing on require; headless mode schedules full/daily with a timezone and never overlaps**: `406a853` (fix)
3. **Task 3: Document the schedule variables, the off toggle and the production recipe**: `f08f1d3` (docs)

Per D-7, the TDD RED steps ran locally (all new suites failed for the expected reasons) and were not committed separately.

## Test Results

- Baseline (before changes): 7 suites / 100 tests green.
- Final: `npx jest --testPathIgnorePatterns fracttal.integration` gives **11 suites / 142 tests, all green**: 100 baseline + 42 new (schedules 23, syncScheduler 9, syncController 6, appHeadless 4). `tests/integration/fracttal.integration.test.js` was never run.
- RED evidence:
  - `schedules` / `syncScheduler`: `Cannot find module`.
  - `syncController`: 5/6 failed (mode ignored). The `manualSync` test also failed with the real unhandled rejection (`SQL no disponible`).
  - `appHeadless`: 4/4 failed (`cron.schedule`/`validate` called at require; `_startHeadless is not a function`).
- Mutation check: temporarily disabling the headless guard made the overlap test fail (`Expected 1, Received 2`). The guard was then restored.

## Smoke Outputs

Task 1, main.js with an invalid zone (`SYNC_TIMEZONE=Mars/Olympus node src/main.js`), returns in under 1 s with no license retries:
```
[CONFIG ERROR] Horarios de sincronización inválidos:
  - SYNC_TIMEZONE="Mars/Olympus" no es una zona horaria IANA válida (ej. "America/Mexico_City")
Corrige el .env y reinicia el servicio.
exit=1
```

Task 2 Smoke A, `node -e "require('./src/app')"` (about 8 s and exit=1 before the fix):
```
exit=0        (elapsed 0s)
```

Task 2 Smoke B, headless with an invalid cron (`SYNC_CRON_SCHEDULE="cada hora" node src/app.js`), immediate:
```
[CONFIG ERROR] Horarios de sincronización inválidos:
  - SYNC_CRON_SCHEDULE="cada hora" no es una expresión cron válida (ej. "0 2 * * *"; usa "off" para no programar la carga completa)
Corrige el .env y reinicia el servicio.
exit=1
```

Extra check, real node-cron with the production recipe (`config/server` + `registerSyncSchedules`):
```
resolved: {"full":null,"daily":"0 12,16,23 * * *","timezone":"America/Mexico_City","errors":[]}
describe: Completa: sin horario (manual) · Diaria: 0 12,16,23 * * * · Zona: America/Mexico_City
tasks registered: 1 | node-cron storage size: 1
```

## User Setup Required: production .env (relay to the user)

The client `.env` on the Windows server is off-limits to the agent. In the SageSync install directory's `.env`, set:

```ini
SYNC_CRON_SCHEDULE=off
SYNC_DAILY_CRON_SCHEDULE=0 12,16,23 * * *
SYNC_TIMEZONE=America/Mexico_City
SYNC_ON_STARTUP=false
```

Then restart the service:

```powershell
Restart-Service SageSync
```

Expected boot line (console / `logs/servy-stdout.log`): `Sincronización programada: Completa: sin horario (manual) · Diaria: 0 12,16,23 * * * · Zona: America/Mexico_City`. The dist build must include this change (CI obfuscation of the new `src/` files is automatic; no new npm scripts were added).

## Files Created/Modified

- `src/config/schedules.js` (new): pure resolver `resolveSyncSchedules(env)`, `describeSyncSchedules()`, frozen `SYNC_MODE_LABELS`.
- `src/services/syncScheduler.js` (new): `registerSyncSchedules()`, `runScheduledSync()`. Never required from app.js.
- `src/config/server.js`: `syncSchedules: resolveSyncSchedules(process.env)` replaces the old single-schedule property.
- `src/main.js`: fail-fast after `validateEnv()`, description in `app.locals.cronSchedule` and the banner, `registerSyncSchedules(...)` replaces the inline cron, `node-cron` require dropped. License gate order is unchanged.
- `src/controllers/syncController.js`: `runSyncWithTracking(sm, { mode })`, labels in logs, mode passed to history, `manualSync` `.catch(() => {})`.
- `src/services/syncStateManager.js`: `endSync` copies `mode` onto the entry, as the last property, only when provided.
- `src/app.js`: requires block plus tail only. `runHeadlessSync` with a module-level flag, new `start()`, `if (require.main === module)`, `_startHeadless` test-only export. Sync functions untouched.
- `tests/config/schedules.test.js`, `tests/services/syncScheduler.test.js`, `tests/controllers/syncController.test.js`, `tests/integration/appHeadless.test.js` (new).
- `docs/DEPLOYMENT.md`, `HANDOFF.md`, `RUNBOOK.md`, `ARCHITECTURE.md`: variables, off toggle, production recipe, boot line, RUNBOOK §9.3 rewritten (an invalid cron now stops boot).

## Decisions Made

- Followed the locked decisions D-1 to D-7 as written.
- Added test coverage beyond the listed behaviors (all additive):
  - exact Spanish error templates and their order;
  - invalid values kept in their fields;
  - `SYNC_MODE_LABELS` frozen;
  - unknown mode falls back to full;
  - the 409 path of `manualSync` stays unchanged;
  - `runScheduledSync` never rejects when `validate()` throws;
  - the headless full-load tick runs `syncInventory`;
  - `logger.error` is not called on the happy headless path.
- Restored the original whitespace-only blank lines inside `runSyncWithTracking` to keep the diff minimal.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The suggested `process.on('unhandledRejection')` spy would have been a vacuous assertion**
- **Found during:** Task 1 (amended manualSync test).
- **Issue:** A scratch probe confirmed that in Jest 29, a spy registered with `process.on('unhandledRejection')` inside a test is never called, even when a rejection really is unhandled. Each test file gets a copied `process` object that Node does not emit on, so "spy not called" would always pass.
- **Fix:** The test flushes promises while it is still running and relies on jest-circus. Jest 29 listens for `unhandledRejection` on the real process and fails the running test with that error. A comment in the test explains this.
- **Verification:** RED against the original code failed with `SQL no disponible` (the unhandled rejection). GREEN after the `.catch`.
- **Files modified:** `tests/controllers/syncController.test.js`.
- **Committed in:** `c7522c2`.

**2. [Rule 2 - Missing critical functionality] Isolated the headless tests from a developer's local `.env`**
- **Found during:** Task 2.
- **Issue:** `src/app.js` calls `require('dotenv').config()` at load. Inside each `jest.isolateModules` load, that would re-read a local `.env` (the main checkout has one, and `tests/setup.js` loads it). It would then re-populate the `SYNC_*` variables the tests deliberately unset. The tests would break on any machine whose `.env` holds the new production recipe.
- **Fix:** `jest.mock('dotenv', () => ({ config: jest.fn() }))` in `tests/integration/appHeadless.test.js`. Each test also starts with all three variables deleted, after the snapshot, and they are restored in `afterEach`.
- **Files modified:** `tests/integration/appHeadless.test.js`.
- **Committed in:** `406a853`.

**3. [Rule 1 - Bug] RUNBOOK boot line named the wrong log**
- **Found during:** Task 3.
- **Issue:** RUNBOOK §2 lists "lo que debes ver en `sagesync.log`". But the `Sincronización programada: ...` description line is printed with `console.log`, so it goes to the console / `servy-stdout.log`, not to winston.
- **Fix:** The rewritten bullet shows the describe line (console / `servy-stdout.log`) and the winston line that does land in `sagesync.log`: `Sincronización DIARIA (delta) programada: "0 12,16,23 * * *" (zona America/Mexico_City)`.
- **Files modified:** `RUNBOOK.md`.
- **Committed in:** `f08f1d3`.

---

**Total deviations:** 3 auto-fixed (2 Rule 1, 1 Rule 2). **Impact:** test reliability and doc accuracy only; no scope change, and no file outside `files_modified` was touched.

## Issues Encountered

None blocking. `npm ci` was needed in the fresh worktree. The worktree branch was reset to base `0adef8c` at startup, as instructed (it had been created from `main`).

## Out-of-Scope Observations (not changed)

- **`.claude/agents/license-guard.md` is stale.** It says the periodic license gate lives in the `main.js` cron callback. It now lives in `runScheduledSync` in `src/services/syncScheduler.js`. `.claude/` is configuration, so it was not edited; flagging it for the user.
- **Delta window gap (functional; affects production):** `sageService.getMovedInventoryItems()` filters `HAVING MAX(V.AUDTDATE) >= <today per the SQL Server's GETDATE()>`, and 23:00 is the last run of the day.
  - Items moved between the 23:00 run and midnight are picked up by no run, unless they move again later. The next day's 12:00 run already filters by the new date.
  - "Today" follows the SQL Server's clock, while the crons follow America/Mexico_City.
  - This is the caveat already noted in STATE.md (pending todo, item 2: "si no, usar ventana >= ayer"). Worth confirming with the user / Santiago before go-live.
- **Other docs outside the edited spots still show only the old variable.** `README.md` (excluded by the plan) and `HANDOFF.md:87` (node-cron row, "2 AM local") still describe only `SYNC_CRON_SCHEDULE`. They remain correct for the unset default. `ARCHITECTURE.md` §8 still has the "Pre-existing failing test" bullet about `updateWarehouseItem`, which is stale: the test is fixed and the baseline was 100/100 green.
- **STATE.md is not updated by this executor.** Its pending todo item 4 ("apuntar el cron al delta (hoy corre la carga completa)") is addressed in code by this task, but production still needs the `.env` change above.
- **No `.env` / `.env.example` was read or created.** `LicenseValidator.js`, `obfuscate.js`, `sageService.js`, `requireLicense.js`, `public/index.html`, `package.json`, `CLAUDE.md`, `.claude/` and `.planning/` content (except this SUMMARY) are untouched.

## Next Phase Readiness

- Code and docs are ready. Production rollout requires the `.env` change plus `Restart-Service SageSync` above, and a dist build containing these commits.
- GitHub #3 and #9 are referenced (`Refs`), not closed, so the user decides when to close them.

## Self-Check: PASSED

- FOUND: src/config/schedules.js, src/services/syncScheduler.js, tests/config/schedules.test.js, tests/services/syncScheduler.test.js, tests/controllers/syncController.test.js, tests/integration/appHeadless.test.js
- FOUND commits: c7522c2, 406a853, f08f1d3 (on `worktree-agent-af0823d3fa48e797b`, base `0adef8c`)
- `git diff --name-only HEAD~3 HEAD` lists exactly the 15 `files_modified`.
