---
phase: quick-261008-jdr
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/config/schedules.js
  - src/config/server.js
  - src/services/syncScheduler.js
  - src/controllers/syncController.js
  - src/services/syncStateManager.js
  - src/main.js
  - src/app.js
  - tests/config/schedules.test.js
  - tests/services/syncScheduler.test.js
  - tests/controllers/syncController.test.js
  - tests/integration/appHeadless.test.js
  - docs/DEPLOYMENT.md
  - HANDOFF.md
  - RUNBOOK.md
  - ARCHITECTURE.md
autonomous: true
requirements: [quick-261008-jdr, GH-3, GH-9]
user_setup:
  - service: sagesync-production-env
    why: "Production must schedule only the daily load. The client .env lives on the Windows server and is off-limits to the agent (permission rule)."
    env_vars:
      - name: SYNC_CRON_SCHEDULE
        source: "Production .env in the SageSync install dir -> set to off (full load stays manual)"
      - name: SYNC_DAILY_CRON_SCHEDULE
        source: "Production .env -> set to 0 12,16,23 * * *"
      - name: SYNC_TIMEZONE
        source: "Production .env -> set to America/Mexico_City (also the default)"
      - name: SYNC_ON_STARTUP
        source: "Production .env -> keep false, then Restart-Service SageSync"

must_haves:
  truths:
    - "With SYNC_CRON_SCHEDULE=off and SYNC_DAILY_CRON_SCHEDULE='0 12,16,23 * * *', the service process (node src/main.js) registers exactly one cron, for the daily/delta load (syncInventoryMoved), with { timezone: 'America/Mexico_City' }; the full load (syncInventory) is not scheduled"
    - "Every scheduled tick re-validates the license (periodic validate(), no startup flag), skips with a warning when the license is invalid or a sync is already in progress, otherwise runs through runSyncWithTracking with the tick's mode"
    - "The full load still runs on demand: dashboard POST /api/sync and SYNC_ON_STARTUP call runSyncWithTracking without options, which runs syncInventory (mode 'full')"
    - "With SYNC_CRON_SCHEDULE, SYNC_DAILY_CRON_SCHEDULE and SYNC_TIMEZONE unset, behavior is backward compatible: full load at '0 2 * * *', no daily schedule, zone America/Mexico_City"
    - "An invalid SYNC_CRON_SCHEDULE, SYNC_DAILY_CRON_SCHEDULE or SYNC_TIMEZONE stops main.js and headless app.js at boot with exit code 1 and a Spanish message naming the variable and the bad value, before any cron.schedule or license call"
    - "Requiring src/app.js (from main.js via syncController, or from sync.js) registers no cron and does not run the startup license gate; only `node src/app.js` (npm run sync-only) starts headless mode, whose runs never overlap"
    - "Sync history entries record which load ran (mode 'full' or 'daily'), and the dashboard shows a one-line Spanish description of the schedules"
  artifacts:
    - path: "src/config/schedules.js"
      provides: "Pure resolver/describer for SYNC_CRON_SCHEDULE, SYNC_DAILY_CRON_SCHEDULE, SYNC_TIMEZONE"
      exports: ["resolveSyncSchedules", "describeSyncSchedules", "SYNC_MODE_LABELS"]
    - path: "src/services/syncScheduler.js"
      provides: "One cron per enabled mode with explicit timezone; license- and in-progress-guarded ticks"
      exports: ["registerSyncSchedules", "runScheduledSync"]
    - path: "src/controllers/syncController.js"
      provides: "runSyncWithTracking(syncStateManager, { mode }) selecting syncInventory vs syncInventoryMoved"
      contains: "syncInventoryMoved"
    - path: "src/app.js"
      provides: "Side-effect-free require; headless start() only when run directly, with overlap guard"
      contains: "require.main === module"
    - path: "tests/config/schedules.test.js"
      provides: "Resolver and describer unit tests"
    - path: "tests/services/syncScheduler.test.js"
      provides: "Registration and tick-guard tests (node-cron mocked)"
    - path: "tests/controllers/syncController.test.js"
      provides: "Mode selection and history mode tests"
    - path: "tests/integration/appHeadless.test.js"
      provides: "Regression test (require app.js schedules nothing) plus headless schedules and overlap guard"
    - path: "docs/DEPLOYMENT.md"
      provides: "Production recipe for the schedule env vars"
      contains: "SYNC_DAILY_CRON_SCHEDULE=0 12,16,23 * * *"
  key_links:
    - from: "src/config/server.js"
      to: "src/config/schedules.js"
      via: "syncSchedules: resolveSyncSchedules(process.env)"
      pattern: "syncSchedules: resolveSyncSchedules\\(process\\.env\\)"
    - from: "src/main.js"
      to: "config.syncSchedules.errors"
      via: "fail-fast right after the module-level validateEnv()"
      pattern: "syncSchedules\\.errors"
    - from: "src/main.js"
      to: "src/services/syncScheduler.js"
      via: "registerSyncSchedules(config.syncSchedules, syncStateManager) inside startServer()"
      pattern: "registerSyncSchedules\\(config\\.syncSchedules, syncStateManager\\)"
    - from: "src/services/syncScheduler.js"
      to: "node-cron"
      via: "cron.schedule(expression, tick, { timezone })"
      pattern: "timezone"
    - from: "src/services/syncScheduler.js"
      to: "src/controllers/syncController.js"
      via: "runSyncWithTracking(syncStateManager, { mode }) after validate() + isValid() + isInProgress() checks"
      pattern: "runSyncWithTracking\\(syncStateManager, \\{ mode \\}\\)"
    - from: "src/controllers/syncController.js"
      to: "src/app.js syncInventoryMoved"
      via: "mode 'daily' selects syncInventoryMoved"
      pattern: "syncInventoryMoved"
    - from: "src/app.js"
      to: "start()"
      via: "only invoked when require.main === module"
      pattern: "if \\(require\\.main === module\\)"
---

<objective>
Make the SageSync Windows service (Servy runs `node src/main.js`) schedule ONLY the daily/delta load (`syncInventoryMoved`) at 12:00, 16:00 and 23:00 Mexico time, and stop scheduling the full load (`syncInventory`). The full load stays manual: the dashboard button (`POST /api/sync`) or `npm run sync`. Also fix the bug where merely requiring `src/app.js` registers an extra, unguarded full-load cron in every process.

Purpose: the full load (~9k items, long-running) must not run unattended in production. The delta load must run at fixed Mexico times regardless of the Windows timezone (GitHub #3). Headless runs must never overlap (GitHub #9).

Output: new `src/config/schedules.js` and `src/services/syncScheduler.js`; a mode-aware `runSyncWithTracking` with mode recorded in history; `main.js` wired to the scheduler with boot-time validation; `app.js` side-effect free on require; 4 new Jest suites; updated DEPLOYMENT / HANDOFF / RUNBOOK / ARCHITECTURE docs. That is three atomic commits on the current branch (`feat/fracttal-carga-diaria-delta`), with no push and no new branch.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md
@src/main.js
@src/config/server.js
@src/controllers/syncController.js
@src/services/syncStateManager.js
@tests/integration/syncInventoryDryRun.test.js

## Locked decisions (D-1 to D-7): implement exactly, do not revisit

These were agreed with the user and verified against the code by the orchestrator.

- **D-1 Env vars.**
  - `SYNC_DAILY_CRON_SCHEDULE` (new) is the cron for the daily/delta load. Unset or empty means the daily load is not scheduled (backward compatible). The production value is `0 12,16,23 * * *`.
  - `SYNC_CRON_SCHEDULE` (existing, full load): unset or empty keeps today's default `0 2 * * *`. NEW: `off` (case-insensitive; also accept `false`, `none`, `disabled`) means the full load is not scheduled.
  - `SYNC_TIMEZONE` (new, the fix proposed in GitHub #3) is the IANA zone passed to EVERY `cron.schedule(expr, fn, { timezone })`. Default `America/Mexico_City`.
  - An invalid cron (`cron.validate` returns false) or an invalid zone (`new Intl.DateTimeFormat('en-US', { timeZone })` throws RangeError) must fail fast at boot. Print a clear Spanish message naming the variable and the bad value, then `process.exit(1)`. Resolution must happen before any `cron.schedule` call, because node-cron throws on values like `off`.
- **D-2 Module layout.**
  - `src/config/schedules.js` (new, English, pure) exports `resolveSyncSchedules(env = process.env)` and `describeSyncSchedules(schedules)`.
  - `src/config/server.js` replaces `syncSchedule` with `syncSchedules: resolveSyncSchedules(process.env)`. `syncOnStartup` is unchanged (opt-in full load at boot, default false).
  - `src/services/syncScheduler.js` (new, English) provides `registerSyncSchedules(schedules, syncStateManager)` and `runScheduledSync(mode, syncStateManager)`. Spanish labels: full = "COMPLETA", daily = "DIARIA (delta)". It must NOT be required by `src/app.js`, because that creates a require cycle (app → scheduler → controller → app).
  - `src/main.js`: fail-fast after `validateEnv()`, `app.locals.cronSchedule = describeSyncSchedules(...)`, `registerSyncSchedules(...)` replaces the inline cron, banner lines print the description, and the unused `node-cron` require is dropped. Do not reorder the license gate.
  - `src/controllers/syncController.js`: `runSyncWithTracking(syncStateManager, { mode = 'full' } = {})` runs `syncInventoryMoved` for `'daily'` and `syncInventory` otherwise. Logs are Spanish per mode, and the mode is passed to history.
  - `src/services/syncStateManager.js`: `endSync` keeps `mode` on the entry when one is provided.
  - No UI change. `public/index.html` prints `data.sync.schedule || 'No configurada'`, and `systemController` keeps returning `cronSchedule` as `schedule`.
- **D-3 app.js bug fix.** `start()` currently runs unconditionally at module load (`start().catch(...)` at the end, since commit 78c2ebe3), so every process that requires app.js gets an extra unguarded full-load cron. Run `start()` only when `require.main === module` (headless `npm run sync-only`). In headless mode:
  - Use `resolveSyncSchedules()` and exit 1 on errors.
  - Schedule full (unless off) and daily (if set) with `{ timezone }`.
  - Guard runs with a simple module-level in-progress flag so they never overlap (closes #9; keep it minimal).
  - Keep today's immediate full `syncInventory()` at headless start.
  - License enforcement stays intact: main.js and sync.js have their own startup gates, and syncInventory/syncInventoryMoved re-validate on every run.
- **D-4 Tests** (Jest 29; the logger is already mocked in `tests/setup.js`):
  - Resolver/describer tests.
  - Scheduler tests with `jest.mock('node-cron')`.
  - `runSyncWithTracking` mode-selection tests that also check history carries `mode`.
  - A test proving that requiring `src/app.js` does not call `cron.schedule`.
  - Run with `npx jest --testPathIgnorePatterns fracttal.integration`. NEVER run `tests/integration/fracttal.integration.test.js`: it authenticates against the real Fracttal API and rewrites `.fracttal-token`.
- **D-5 Docs** (minimal): the `docs/DEPLOYMENT.md` .env section, adding the new vars, `SYNC_CRON_SCHEDULE=off` and the production recipe; the `HANDOFF.md` env table rows; the `ARCHITECTURE.md` server.js row. Production recipe: `SYNC_CRON_SCHEDULE=off`, `SYNC_DAILY_CRON_SCHEDULE=0 12,16,23 * * *`, `SYNC_TIMEZONE=America/Mexico_City`, `SYNC_ON_STARTUP=false`. Do NOT read or edit `.env` / `.env.example`.
- **D-6 Do not touch:** `src/services/LicenseValidator.js`, `scripts/obfuscate.js` (no new npm scripts are needed; new `src/` files are obfuscated automatically), the 3-case sync loops in `src/app.js`, the delta query in `sageService`, the `requireLicense` middleware, `public/index.html`, `package.json`, and any `.planning/` content.
- **D-7 Commits:** one atomic commit per task, in repo style (`feat(sync): ...`, `fix(app): ...`, `docs: ...`). Each message ENDS with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No push. Because of this, task-level TDD runs RED locally but does NOT get a separate `test(...)` commit.

## Verified facts (planner, 2026-10-08)

- No `node_modules` in a fresh checkout or worktree: run `npm ci` first from the repo root.
- Baseline after `npm ci`: `npx jest --testPathIgnorePatterns fracttal.integration` gives 7 suites / 100 tests, all green. The old deferred `fracttalClient.test.js > updateWarehouseItem` failure is already fixed in the test. If it ever reappears, report it in SUMMARY and do not fix it here.
- node-cron is locked at 3.0.3. It exports `schedule`, `validate` and `getTasks`. `schedule(expr, fn, { timezone })` builds an `Intl.DateTimeFormat` with that zone.
  - `validate` returns true for `'0 2 * * *'`, `'0 12,16,23 * * *'` and `'*/5 * * * *'`.
  - `validate` returns false for `'off'`, `'cada hora'`, `'61 * * * *'` and `''`.
  - `cron.schedule('off', ...)` throws.
- `new Intl.DateTimeFormat('en-US', { timeZone: 'Mars/Olympus' })` throws RangeError. `'UTC'`, `'America/Mexico_City'` and `'america/mexico_city'` are accepted.
- Bug reproduced: with the dummy env vars from the smoke commands below, `node -e "require('./src/app')"` exits 1 after about 8 s today, because requiring app.js runs the startup license gate (and would then register a cron). After Task 2 it must exit 0 immediately.
- A scratch prototype confirmed the test pattern:
  - Inside `jest.isolateModules`, with module-scope `mock*` fns shared through `jest.mock` factories, requiring the current app.js calls `validate` once immediately and `cron.schedule` once after one `setImmediate` flush (RED).
  - A logger required inside the same `isolateModules` callback is the instance app.js uses.
  - Each isolated load re-executes app.js, giving fresh module state.
  - In Jest, `require.main === module` is false for `src/` modules.
- `.claude/commands/log-tail.md` searches logs for the exact text `License invalid — skipping scheduled sync`. Keep that prefix in the scheduler warning.
- Untracked user files in the repo root (`ESTADO-SAGESYNC-REUNION.md`, `INFORME-CAPSTONE-2026-06-05.md`, `PLAN-FRACTTAL.md`, `RUNBOOK-SYNC-TEST-PROD.md`) must stay untracked. Stage files by explicit path only, never `git add -A` or `git add .`.
- `.env` and `.env.example` do not exist in the repo. Never read or create them.

## Out of scope: do not fix, only mention in SUMMARY

- ~~`manualSync` unhandled rejection~~: moved INTO Task 1 by the orchestrator (see Task 1, step 5).
- `.claude/agents/license-guard.md` says the periodic license gate lives in the main.js cron callback. After this task it lives in `syncScheduler.runScheduledSync`. Do not edit `.claude/` (configuration); flag it for the user.

<interfaces>
Contracts the executor implements and consumes. All are verified against the current code except the NEW ones, which this plan defines.

```js
// src/config/schedules.js (NEW): English code/comments; user-facing strings in Spanish.
// Requires only node-cron. Pure: no logging, no process.exit, reads env only via the parameter.
/**
 * @typedef {Object} SyncSchedules
 * @property {string|null} full     cron for the FULL load (syncInventory); null = not scheduled
 * @property {string|null} daily    cron for the DAILY/delta load (syncInventoryMoved); null = not scheduled
 * @property {string} timezone      IANA zone used for every cron.schedule
 * @property {string[]} errors      Spanish, one per invalid variable; non-empty => caller must exit(1)
 */
function resolveSyncSchedules(env = process.env) {}  // -> SyncSchedules
function describeSyncSchedules(schedules) {}         // -> one-line Spanish string
const SYNC_MODE_LABELS = Object.freeze({ full: 'COMPLETA', daily: 'DIARIA (delta)' });
module.exports = { resolveSyncSchedules, describeSyncSchedules, SYNC_MODE_LABELS };

// Exact describe output (a null schedule renders as 'sin horario (manual)'):
//   { full: null, daily: '0 12,16,23 * * *', timezone: 'America/Mexico_City' }
//     -> 'Completa: sin horario (manual) · Diaria: 0 12,16,23 * * * · Zona: America/Mexico_City'
//   { full: '0 2 * * *', daily: null, timezone: 'America/Mexico_City' }
//     -> 'Completa: 0 2 * * * · Diaria: sin horario (manual) · Zona: America/Mexico_City'

// Exact error templates (<v> = normalized value as typed by the operator):
//   SYNC_CRON_SCHEDULE="<v>" no es una expresión cron válida (ej. "0 2 * * *"; usa "off" para no programar la carga completa)
//   SYNC_DAILY_CRON_SCHEDULE="<v>" no es una expresión cron válida (ej. "0 12,16,23 * * *"; déjala vacía o usa "off" para no programar la carga diaria)
//   SYNC_TIMEZONE="<v>" no es una zona horaria IANA válida (ej. "America/Mexico_City")

// src/services/syncScheduler.js (NEW): English code/comments; log messages in Spanish.
async function runScheduledSync(mode, syncStateManager) {}     // never rejects
function registerSyncSchedules(schedules, syncStateManager) {}  // -> array of node-cron tasks
module.exports = { registerSyncSchedules, runScheduledSync };

// src/controllers/syncController.js (CHANGED, backward compatible)
async function runSyncWithTracking(syncStateManager, { mode = 'full' } = {}) {}
// 'daily' -> syncInventoryMoved(); anything else -> syncInventory(); still rethrows on failure

// src/services/syncStateManager.js (existing class; Spanish file)
isInProgress()                                               // boolean
startSync()                                                  // -> Date; throws 'Sincronización ya en progreso' if busy
endSync({ success, data, error, mode }, startTime)           // NEW: copies mode onto the entry when provided
getState()                                                   // { inProgress, stats, lastResult, history }
getHistory(limit = 10)

// src/services/LicenseValidator.js (existing, DO NOT MODIFY)
validate(options)   // Promise; { startup: true } retries 3x then process.exit(1); no args = periodic
isValid()           // boolean (synchronous cache)

// src/app.js (existing exports; Task 2 adds _startHeadless as a test-only alias of start)
syncInventory(options = {})       // Promise<summary | undefined>; re-validates license itself
syncInventoryMoved(options = {})  // Promise<summary | undefined>; re-validates license itself

// node-cron 3.0.3
cron.schedule(expression, func, { timezone })   // starts immediately; returns ScheduledTask
cron.validate(expression)                       // boolean
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Schedule resolver + scheduler service + mode-aware tracking, wired into main.js</name>
  <files>src/config/schedules.js, src/config/server.js, src/services/syncScheduler.js, src/controllers/syncController.js, src/services/syncStateManager.js, src/main.js, tests/config/schedules.test.js, tests/services/syncScheduler.test.js, tests/controllers/syncController.test.js</files>
  <read_first>src/main.js, src/config/server.js, src/controllers/syncController.js, src/services/syncStateManager.js, tests/setup.js, tests/integration/syncInventoryDryRun.test.js (mock style only)</read_first>
  <behavior>
    tests/config/schedules.test.js uses the real node-cron and always passes explicit env objects; never rely on process.env.
    - resolveSyncSchedules({}) deep-equals { full: '0 2 * * *', daily: null, timezone: 'America/Mexico_City', errors: [] }.
    - SYNC_CRON_SCHEDULE set to each of 'off', 'OFF', 'Off', 'false', 'none', 'disabled', ' Disabled ' gives full === null and errors [].
    - Production recipe { SYNC_CRON_SCHEDULE: 'off', SYNC_DAILY_CRON_SCHEDULE: '0 12,16,23 * * *' } deep-equals { full: null, daily: '0 12,16,23 * * *', timezone: 'America/Mexico_City', errors: [] }.
    - SYNC_DAILY_CRON_SCHEDULE of '' or 'OFF' gives daily === null with no errors.
    - Whitespace handling:
      - SYNC_DAILY_CRON_SCHEDULE '  0  12,16,23 * * *  ' becomes '0 12,16,23 * * *'.
      - SYNC_TIMEZONE '  America/Monterrey ' becomes 'America/Monterrey'.
      - SYNC_CRON_SCHEDULE '   ' falls back to '0 2 * * *'.
    - SYNC_TIMEZONE 'UTC' gives timezone 'UTC' and no errors.
    - SYNC_CRON_SCHEDULE 'cada hora' gives exactly 1 error, which starts with 'SYNC_CRON_SCHEDULE=' and contains 'cada hora'.
    - SYNC_DAILY_CRON_SCHEDULE '61 * * * *' gives errors[0] starting with 'SYNC_DAILY_CRON_SCHEDULE=' and containing '61 * * * *'.
    - SYNC_TIMEZONE 'Mars/Olympus' gives errors[0] starting with 'SYNC_TIMEZONE=' and containing 'Mars/Olympus'.
    - All three invalid at once gives 3 errors (everything is reported in one boot, like validateEnv).
    - describeSyncSchedules returns the exact strings from interfaces, for both the production recipe and the defaults.

    tests/services/syncScheduler.test.js mocks node-cron, LicenseValidator and controllers/syncController.
    - schedules { full: null, daily: '0 12,16,23 * * *', timezone: 'America/Mexico_City', errors: [] }: cron.schedule is called exactly once, with ('0 12,16,23 * * *', expect.any(Function), { timezone: 'America/Mexico_City' }).
    - { full: '0 2 * * *', daily: '0 12,16,23 * * *', timezone: 'UTC' }: two calls, full first, both with { timezone: 'UTC' }.
    - { full: null, daily: null }: zero calls.
    - Tick with isValid() false: validate is called with no arguments, runSyncWithTracking is not called, and logger.warn receives a message containing 'License invalid — skipping scheduled sync'.
    - Tick with syncStateManager.isInProgress() true: runSyncWithTracking is not called and logger.warn contains 'ya hay una en progreso'.
    - Tick with a valid license and no sync running: runSyncWithTracking is called once with (syncStateManager, { mode: 'daily' }) for the daily task. The full task's tick passes { mode: 'full' }.
    - If runSyncWithTracking rejects, the tick promise still resolves (no throw) and logger.error is called.

    tests/controllers/syncController.test.js mocks '../../src/app' as { syncInventory: jest.fn(), syncInventoryMoved: jest.fn() } and uses a real SyncStateManager.
    - runSyncWithTracking(sm) calls syncInventory once and syncInventoryMoved never. sm.getHistory()[0] has success true, mode 'full', and the mocked summary fields (e.g. processedItems).
    - runSyncWithTracking(sm, { mode: 'daily' }) calls syncInventoryMoved once and syncInventory never. Both history[0].mode and getState().lastResult.mode are 'daily'.
    - If syncInventoryMoved rejects with new Error('boom'), the promise rejects with that error, history[0] matches { success: false, error: 'boom', mode: 'daily' }, and sm.isInProgress() is false afterwards.
  </behavior>
  <action>
  Run every command from the repo root.

  0. Setup: if `node_modules/` is missing (fresh checkout or worktree), run `npm ci`. Never read or edit `.env` or `.env.example`.

  1. RED: create the three test files exactly as listed in behavior.
     - Follow the mock style of tests/integration/syncInventoryDryRun.test.js.
     - The logger is already mocked globally by tests/setup.js. Get it with `require('../../src/config/logger')`.
     - In tests/services/syncScheduler.test.js, mock:
       - `node-cron` as `{ schedule: jest.fn(() => ({ stop: jest.fn() })), validate: jest.fn(() => true) }`;
       - `../../src/services/LicenseValidator` as `{ validate: jest.fn(), isValid: jest.fn(), getStatus: jest.fn() }`;
       - `../../src/controllers/syncController` as `{ runSyncWithTracking: jest.fn() }`. This also keeps src/app.js out of the test, which matters because app.js calls validateEnv at load.
     - In that file's beforeEach, call `jest.clearAllMocks()` and then set defaults: `validate.mockResolvedValue({ state: 'VALID', valid: true })`, `isValid.mockReturnValue(true)`, `runSyncWithTracking.mockResolvedValue(undefined)`. Take each tick from `cron.schedule.mock.calls[i][1]` and await it.
     - In tests/controllers/syncController.test.js, silence console.log and console.error with jest.spyOn (runSyncWithTracking prints emojis).
     - Run the three files. They must FAIL (missing modules, mode ignored). Per D-7, do not commit the RED state.

  2. Create src/config/schedules.js per D-1, D-2 and the contract in interfaces. Use English code and comments, Spanish user-facing strings. Require only node-cron; no logging, no process.exit, no process.env access except through the default parameter.
     - Normalize every raw value: `String(raw ?? '')`, then trim, then collapse internal whitespace runs to a single space.
     - The off-values are off, false, none and disabled, compared lower-cased.
     - full: empty → '0 2 * * *'; off-value → null; otherwise the value, adding an error if `cron.validate` fails.
     - daily: empty or off-value → null; otherwise the value, adding an error if invalid. Accepting off-values for daily too is a deliberate symmetry choice.
     - timezone: empty → 'America/Mexico_City'; otherwise the value, adding an error if `new Intl.DateTimeFormat('en-US', { timeZone })` throws.
     - Invalid values stay in their fields. That way, a caller that forgets to check `errors` fails loudly inside node-cron instead of silently scheduling nothing.
     - Collect ALL errors, using the exact Spanish templates.
     - describeSyncSchedules uses the exact format from interfaces.
     - Export SYNC_MODE_LABELS frozen.

  3. src/config/server.js: right after `require('dotenv').config();`, require resolveSyncSchedules from `./schedules`. Replace the `syncSchedule:` property with `syncSchedules: resolveSyncSchedules(process.env),`. Leave everything else as is, including syncOnStartup. Only main.js consumed the old `syncSchedule` property.

  4. Create src/services/syncScheduler.js per D-2. Use English code and comments, Spanish log messages.
     - Requires: node-cron, ../config/logger, ./LicenseValidator (validate, isValid), ../controllers/syncController (runSyncWithTracking), ../config/schedules (SYNC_MODE_LABELS).
     - Add a header comment saying this module must never be required from src/app.js (require cycle).
     - runScheduledSync(mode, syncStateManager) keeps today's per-tick behavior from main.js. Use label = SYNC_MODE_LABELS[mode]. Inside a try:
       - `await validate()` with NO arguments. This is the periodic LIC-02 re-validation, never the startup variant.
       - If `!isValid()`: logger.warn with the exact existing text `License invalid — skipping scheduled sync` plus ` (<label>)`, then return. Keep this English prefix because log-tail searches for it.
       - Else if `syncStateManager.isInProgress()`: logger.warn `Sincronización programada <label> saltada - ya hay una en progreso`, then return.
       - Else: logger.info `Ejecutando sincronización programada <label>...`, then `await runSyncWithTracking(syncStateManager, { mode })`.
       - In the catch: logger.error with message `Error en sincronización programada <label>:` and the error. Never rethrow.
     - registerSyncSchedules(schedules, syncStateManager) iterates modes in the order full, then daily:
       - If `schedules[mode]` is falsy: logger.info `Sincronización <label>: sin horario programado (solo manual)`.
       - Otherwise: `cron.schedule(expression, () => runScheduledSync(mode, syncStateManager), { timezone: schedules.timezone })`. The arrow must return the promise so tests can await the tick. Then logger.info `Sincronización <label> programada: "<expression>" (zona <timezone>)`.
       - Return the array of created tasks.

  5. src/controllers/syncController.js (Spanish file):
     - Import syncInventoryMoved next to syncInventory from ../app, and SYNC_MODE_LABELS from ../config/schedules.
     - Change the signature to `runSyncWithTracking(syncStateManager, { mode = 'full' } = {})`.
     - Normalize with `const syncMode = mode === 'daily' ? 'daily' : 'full'`. Run syncInventoryMoved for daily and syncInventory otherwise.
     - Put the label (COMPLETA / DIARIA (delta)) into the existing console and logger messages: `Iniciando sincronización <label>`, `Sincronización <label> completada exitosamente`, `Error en sincronización <label>:`.
     - Pass `mode: syncMode` in both endSync calls and keep the rethrow.
     - previewSync, getSyncStatus and getSyncHistory are unchanged. manualSync keeps calling `runSyncWithTracking(syncStateManager)` with no options, so the dashboard button is the manual full load.
     - Orchestrator amendment (2026-10-08): manualSync starts the run in the background without await, and the promise is currently unhandled. Since the full load is now manual-only, a failed manual run (SQL error, auth failure, bad config.json) would crash the service (Node 18 aborts on unhandled rejections) and Servy would restart it. Change only that call to `runSyncWithTracking(syncStateManager).catch(() => {});` with a short Spanish comment: the error is already logged and recorded in the history inside runSyncWithTracking. Keep the 409 guard and the response unchanged.
     - Add a test in tests/controllers/syncController.test.js: call `manualSync(req, res, next)` with `req.app.locals.syncStateManager` (real SyncStateManager) and `res.json`/`res.status` mocks, with the mocked syncInventory rejecting. After flushing promises, assert the response was `{ message: 'Sincronización iniciada', inProgress: true }`, the history has one entry with `success: false` and `mode: 'full'`, and no unhandled rejection happened (e.g. a `process.on('unhandledRejection')` spy registered for the test was not called).

  6. src/services/syncStateManager.js (Spanish file): in endSync, add mode to syncResult as the LAST property, only when provided, by spreading `result.mode ? { mode: result.mode } : {}`. Add a short Spanish comment (tipo de carga 'full' | 'daily' para el historial). Nothing else changes.

  7. src/main.js (Spanish comments). DO NOT reorder the license gate: validateEnv → validateLicense({startup:true}) → express.json → requireLicense wrapper → express.static → routes → errorHandler.
     - (a) Remove `const cron = require('node-cron');`. Reduce the LicenseValidator import to `{ validate: validateLicense }`, since isValid moves to the scheduler.
     - (b) Require describeSyncSchedules from ./config/schedules and registerSyncSchedules from ./services/syncScheduler. Keep the runSyncWithTracking import, which SYNC_ON_STARTUP still uses.
     - (c) Immediately after the existing module-level `validateEnv();`, add a Spanish-commented fail-fast. If `config.syncSchedules.errors.length > 0`:
       - console.error `[CONFIG ERROR] Horarios de sincronización inválidos:`;
       - one console.error line per error, prefixed with two spaces and a dash;
       - console.error `Corrige el .env y reinicia el servicio.`;
       - `process.exit(1)`.
       Use console.error as validateEnv does: winston's file transport may not flush before exit, and under Servy stderr lands in logs/servy-stderr.log.
     - (d) In startServer, compute `const scheduleDescription = describeSyncSchedules(config.syncSchedules)` and set `app.locals.cronSchedule = scheduleDescription`. The dashboard reads it via systemController as `sync.schedule`.
     - (e) Replace everything from the comment `// Programar sincronización automática` through the end of the inline cron.schedule call. In the same position (after app.locals, before routes) put:
       - a Spanish comment (un cron por tipo de carga habilitado, con zona horaria explícita);
       - the existing console.log `Sincronización programada: ` followed by scheduleDescription;
       - `registerSyncSchedules(config.syncSchedules, syncStateManager);`.
     - (f) The banner line inside app.listen prints `Sincronización programada: ` followed by scheduleDescription.
     - The SYNC_ON_STARTUP block is unchanged.

  8. GREEN: run the three new files, then the full suite, then the smoke from verify. NEVER run tests/integration/fracttal.integration.test.js.

  9. Commit per D-7. `git add` ONLY the 9 paths in files.
     - Subject: `feat(sync): schedule only the daily load via SYNC_DAILY_CRON_SCHEDULE`.
     - Body: 3 to 5 bullets covering the resolver and env vars (off-values, default timezone), the scheduler with explicit timezone and license/in-progress guard, mode-aware tracking and history, and main.js fail-fast plus the dashboard description.
     - Then a line `Refs #3`, then a line `Quick task: 261008-jdr`, a blank line, and the final line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
     - No push.
  </action>
  <verify>
    <automated>npx jest tests/config/schedules.test.js tests/services/syncScheduler.test.js tests/controllers/syncController.test.js && npx jest --testPathIgnorePatterns fracttal.integration</automated>
    Smoke (no network; the dummy values only satisfy validateEnv):
    `env LICENSE_API_URL=http://127.0.0.1:9 HMAC_SECRET=x SAGESYNC_API_KEY=x DB_HOST=x DB_USER=x DB_PASSWORD=x DB_NAME=x FRACTTAL_CLIENT_ID=x FRACTTAL_CLIENT_SECRET=x NODE_ENV=production SYNC_TIMEZONE=Mars/Olympus node src/main.js; echo "exit=$?"`
    Expected: stderr shows `[CONFIG ERROR] Horarios de sincronización inválidos:` and a line containing `SYNC_TIMEZONE="Mars/Olympus"`, the command prints `exit=1`, and it returns in about a second (no license retries).
    Leftovers: `grep -n "require('node-cron')" src/main.js` and `grep -rnw "syncSchedule" src/` both print nothing.
  </verify>
  <done>
  - The three new suites pass, and the full suite (excluding fracttal.integration) is green: the 100 baseline tests plus the new ones.
  - The smoke exits 1 with the SYNC_TIMEZONE message.
  - main.js no longer requires node-cron and has no inline cron.schedule.
  - `git show --stat HEAD` lists exactly the 9 files. LicenseValidator.js, sageService.js, requireLicense.js and public/index.html are untouched.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: app.js does nothing on require; headless mode schedules full/daily with a timezone and never overlaps</name>
  <files>src/app.js, tests/integration/appHeadless.test.js</files>
  <read_first>src/app.js lines 1-18 and 545-563 only (the sync functions in lines 19-545 are out of scope), src/config/schedules.js (from Task 1), tests/integration/syncInventoryDryRun.test.js</read_first>
  <behavior>
    tests/integration/appHeadless.test.js setup:
    - Module-scope shared mocks, named with the `mock` prefix so jest.mock factories can reference them:
      - mockSchedule; node-cron is mocked as { schedule: mockSchedule, validate: jest.fn(() => true) }.
      - mockValidate and mockIsValid for LicenseValidator, plus getStatus.
      - mockSage { validateConnection, getAllInventoryItems, getMovedInventoryItems, mapSageLocationToFracttalWarehouse }.
      - mockFracttal { getAccessToken }.
      - validateEnv and configManager mocked as in syncInventoryDryRun.test.js.
    - A loadApp helper calls jest.isolateModules and, inside the same callback, requires both '../../src/app' and '../../src/config/logger'. This gives fresh module state per test plus the logger instance app.js uses.
    - beforeEach: jest.clearAllMocks(), then defaults: validate resolves VALID, isValid true, validateConnection true, getAccessToken 'token', getAllInventoryItems [], getMovedInventoryItems [].
    - Snapshot SYNC_CRON_SCHEDULE, SYNC_DAILY_CRON_SCHEDULE and SYNC_TIMEZONE in beforeEach and restore them in afterEach, deleting any that were originally undefined.
    - flush is `new Promise((r) => setImmediate(r))`.

    Tests:
    - Requiring src/app, then awaiting flush: mockSchedule is never called AND mockValidate is never called. Today both are called, so this is RED.
    - With SYNC_CRON_SCHEDULE='off', SYNC_DAILY_CRON_SCHEDULE='0 12,16,23 * * *' and SYNC_TIMEZONE unset, `await app._startHeadless()`:
      - mockValidate is called with { startup: true }, and its first invocationCallOrder precedes mockSchedule's first;
      - mockSchedule is called exactly once, with ('0 12,16,23 * * *', expect.any(Function), { timezone: 'America/Mexico_City' });
      - getAllInventoryItems is called once (the immediate full run is kept).
    - With all three vars unset: exactly one mockSchedule call, ('0 2 * * *', expect.any(Function), { timezone: 'America/Mexico_City' }).
    - Overlap guard (GitHub #9):
      - After _startHeadless with the daily-only env, take the daily tick from mockSchedule.mock.calls[0][1].
      - Make getMovedInventoryItems return a deferred promise once.
      - Start tick 1 without awaiting it, then flush.
      - Call and await tick 2. getMovedInventoryItems has still been called only once, and logger.warn received a message containing 'ya hay una en progreso'.
      - Resolve the deferred and await tick 1.
      - Tick 3 runs again, so getMovedInventoryItems has now been called twice.
  </behavior>
  <action>
  1. RED: write tests/integration/appHeadless.test.js as listed in behavior and run it. The first test must fail on the current app.js; the planner prototype confirmed that validate and cron.schedule are called at require time. The others fail because `_startHeadless` is not exported yet. Per D-7, do not commit the RED state.

  2. Edit src/app.js (Spanish comments and logs). Touch ONLY the requires block and the code after syncInventoryMoved. Per D-6, do not modify syncInventory, syncInventoryMoved or their 3-case loops.
     - (a) Next to the other requires, require `{ resolveSyncSchedules, SYNC_MODE_LABELS }` from ./config/schedules. Never require ./services/syncScheduler here (require cycle, D-2).
     - (b) Add a module-level flag (for example `headlessSyncInProgress = false`) and an internal `async function runHeadlessSync(mode)`, with a Spanish comment citing issue #9:
       - take the label from SYNC_MODE_LABELS;
       - if the flag is set, logger.warn `Sincronización <label> saltada - ya hay una en progreso` and return;
       - otherwise set the flag, then in a try `await syncInventoryMoved()` for 'daily' or `await syncInventory()` otherwise;
       - in the catch, logger.error with `Error en sincronización <label> (modo headless):` and the error;
       - in a finally, clear the flag. The function never rejects.
     - (c) Rewrite `start()` in this order:
       1. `const schedules = resolveSyncSchedules(process.env)`. On errors, print the same console.error block as main.js and `process.exit(1)`, before any network or cron call.
       2. `await validateLicense({ startup: true })`. The startup gate runs before any cron registration or sync (license-guard invariant).
       3. For full, then daily: if set, `cron.schedule(expr, () => runHeadlessSync(mode), { timezone: schedules.timezone })` plus logger.info `Sincronización <label> programada: "<expr>" (zona <tz>)`; otherwise logger.info `Sincronización <label>: sin horario programado (solo manual)`.
       4. `await runHeadlessSync('full')`. This is the immediate full run headless mode always did (D-3). Awaiting it means start() resolves only after it, which keeps tests deterministic.
     - (d) Wrap the existing unconditional `start().catch(...)` in `if (require.main === module) { ... }`. Add a Spanish comment: only `node src/app.js` (npm run sync-only) starts headless mode; `require('./app')` from main.js (via syncController) or sync.js schedules nothing. Before this change it registered an extra, unguarded full-load cron in every process.
     - (e) Set exports to `module.exports = { syncInventory, syncInventoryMoved, _startHeadless: start };`. Add a Spanish comment that `_startHeadless` exists only for tests and must never be called from main.js or sync.js, because it would register duplicate crons.
     - License enforcement stays intact: main.js and sync.js keep their own startup gates, and syncInventory/syncInventoryMoved re-validate on every run.

  3. GREEN: run the new file and tests/integration/syncInventoryDryRun.test.js. That suite's node-cron mock has no `validate`, which is fine because schedules.js only calls it inside resolveSyncSchedules. Then run the full suite (never fracttal.integration) and both smokes from verify.

  4. Commit per D-7. Run `git add src/app.js tests/integration/appHeadless.test.js` only.
     - Subject: `fix(app): only start the headless scheduler when src/app.js runs directly`.
     - Body bullets: requiring app.js no longer runs the startup gate or registers an unguarded full-load cron (which caused a double 02:00 run under the service); headless mode resolves the SYNC_* schedules (exit 1 if invalid), uses SYNC_TIMEZONE, and honors SYNC_CRON_SCHEDULE=off and SYNC_DAILY_CRON_SCHEDULE; a module-level guard keeps headless runs from overlapping.
     - Then `Refs #3, #9`, `Quick task: 261008-jdr`, a blank line, and the final line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
     - No push.
  </action>
  <verify>
    <automated>npx jest tests/integration/appHeadless.test.js tests/integration/syncInventoryDryRun.test.js && npx jest --testPathIgnorePatterns fracttal.integration</automated>
    Smoke A, bug fixed (no network):
    `env LICENSE_API_URL=http://127.0.0.1:9 HMAC_SECRET=x SAGESYNC_API_KEY=x DB_HOST=x DB_USER=x DB_PASSWORD=x DB_NAME=x FRACTTAL_CLIENT_ID=x FRACTTAL_CLIENT_SECRET=x NODE_ENV=production node -e "require('./src/app')"; echo "exit=$?"`
    Expected: `exit=0` within about a second. Before the fix it printed `exit=1` after about 8 s.
    Smoke B, headless fail-fast:
    `env LICENSE_API_URL=http://127.0.0.1:9 HMAC_SECRET=x SAGESYNC_API_KEY=x DB_HOST=x DB_USER=x DB_PASSWORD=x DB_NAME=x FRACTTAL_CLIENT_ID=x FRACTTAL_CLIENT_SECRET=x NODE_ENV=production SYNC_CRON_SCHEDULE="cada hora" node src/app.js; echo "exit=$?"`
    Expected: `[CONFIG ERROR]` and `SYNC_CRON_SCHEDULE="cada hora"` on stderr, `exit=1`, immediately.
  </verify>
  <done>
  - appHeadless (4 tests) and syncInventoryDryRun pass, and the full suite is green.
  - Smoke A prints exit=0 promptly and Smoke B prints exit=1 with the variable named.
  - In src/app.js, `start().catch` appears only inside `if (require.main === module)`.
  - The sync functions are untouched (the diff touches only the requires block and the tail of the file).
  - `git show --stat HEAD` lists exactly the 2 files.
  </done>
</task>

<task type="auto">
  <name>Task 3: Document the schedule variables, the off toggle and the production recipe</name>
  <files>docs/DEPLOYMENT.md, HANDOFF.md, RUNBOOK.md, ARCHITECTURE.md</files>
  <read_first>docs/DEPLOYMENT.md lines 55-95, 155-168 and 260-285; HANDOFF.md lines 294-326; RUNBOOK.md lines 97-110 and 399-406; ARCHITECTURE.md lines 54-63, 84-104, 112-142 and 336-347</read_first>
  <action>
  Keep each file's language: DEPLOYMENT, HANDOFF and RUNBOOK are Spanish, ARCHITECTURE is English (CLAUDE.md convention). Edit only the spots below; D-5 asks for minimal changes. Wherever a boot line is shown, use the exact describe output from Task 1: `Completa: sin horario (manual) · Diaria: 0 12,16,23 * * * · Zona: America/Mexico_City`.

  1. docs/DEPLOYMENT.md
     - (a) In the .env block under `# ====== SINCRONIZACIÓN ======`, replace the line `SYNC_CRON_SCHEDULE=0 2 * * *` with the production recipe. Precede each variable with a one-line Spanish comment:
       - `SYNC_CRON_SCHEDULE=off` (carga COMPLETA: no se programa; se corre a mano);
       - `SYNC_DAILY_CRON_SCHEDULE=0 12,16,23 * * *` (carga DIARIA/delta a las 12:00, 16:00 y 23:00);
       - `SYNC_TIMEZONE=America/Mexico_City` (zona de todos los horarios).
       Keep SYNC_BATCH_SIZE, SYNC_TIMEOUT and `SYNC_ON_STARTUP=false`.
     - (b) Right after that code block, add a short Spanish note titled "Horarios de sincronización" with four bullets:
       - SYNC_CRON_SCHEDULE: empty means `0 2 * * *` (comportamiento anterior); `off`, `false`, `none` or `disabled` means it is not scheduled. The full load can always be run by hand with the dashboard sync button (`POST /api/sync`) or `npm run sync`.
       - SYNC_DAILY_CRON_SCHEDULE: empty or `off` means it is not scheduled. It only picks up what moved today.
       - SYNC_TIMEZONE: IANA zone, default America/Mexico_City, independent of the Windows server's timezone.
       - Any invalid value means the service does NOT start (exit 1), and the message names the variable and the value (see `logs/servy-stderr.log`).
     - (c) In the "Resultado esperado" block (around line 165), change the `Sincronización programada:` line to the describe output.
     - (d) Rewrite §9c "Probar con cron automático" to test the daily schedule:
       - set `SYNC_CRON_SCHEDULE=off` plus `SYNC_DAILY_CRON_SCHEDULE=*/5 * * * *`;
       - step 1 notes that the delta only picks up items moved TODAY;
       - the restore step sets `SYNC_DAILY_CRON_SCHEDULE=0 12,16,23 * * *` instead of `SYNC_CRON_SCHEDULE=0 2 * * *`.

  2. HANDOFF.md §12 table (columns Variable | Grupo | Sensible | Descripción | Ejemplo)
     - Update the SYNC_CRON_SCHEDULE row: carga COMPLETA; `off`/`false`/`none`/`disabled` = no se programa, solo manual. Ejemplo: `0 2 * * *` (default) · producción `off`.
     - Directly below it, add a SYNC_DAILY_CRON_SCHEDULE row: sync | No | carga DIARIA/delta (`syncInventoryMoved`); vacío u `off` = no se programa | producción `0 12,16,23 * * *`.
     - Below that, add a SYNC_TIMEZONE row: sync | No | zona horaria IANA de todos los crons | `America/Mexico_City` (default).
     - Append one sentence to the paragraph after the table: al arrancar también se validan SYNC_CRON_SCHEDULE, SYNC_DAILY_CRON_SCHEDULE y SYNC_TIMEZONE; un valor inválido aborta con exit 1 y un mensaje que nombra la variable.

  3. RUNBOOK.md
     - (a) Around line 101, the expected boot line becomes `Sincronización programada: ` plus the describe output, labeled as the production recipe.
     - (b) Around line 108, replace "sin esperar las 2 AM" with "sin esperar al siguiente horario programado (en producción la carga completa no tiene horario)".
     - (c) Rewrite §9.3. There is now a clean toggle: set `SYNC_CRON_SCHEDULE=off`, leave `SYNC_DAILY_CRON_SCHEDULE` empty (or `off`), then `Restart-Service SageSync`. The dashboard stays up, nothing is scheduled, and manual loads still work. Warn explicitly that an invalid cron expression is NO longer a workaround: since this change it stops the service at boot (exit 1). Keep the `Stop-Service SageSync` alternative.
     This RUNBOOK edit is required, not optional: following the old §9.3 advice would now take the service down.

  4. ARCHITECTURE.md (English)
     - (a) `src/config/` table:
       - server.js row: it now resolves SYNC_CRON_SCHEDULE / SYNC_DAILY_CRON_SCHEDULE / SYNC_TIMEZONE through schedules.js. Public surface: `{ port, syncSchedules: { full, daily, timezone, errors }, syncOnStartup, logs, pagination }`.
       - Add a schedules.js row: pure resolver; the defaults and off-values; invalid values are returned in `errors` and the entry points exit 1; exports resolveSyncSchedules, describeSyncSchedules, SYNC_MODE_LABELS.
     - (b) Controllers table, syncController row: `runSyncWithTracking(syncStateManager, { mode })`. 'full' (default) runs syncInventory and 'daily' runs syncInventoryMoved; history records the mode; used by syncScheduler and SYNC_ON_STARTUP.
     - (c) Services table: add a syncScheduler.js row. One cron per enabled mode with `{ timezone }`. Each tick runs a periodic validate(), skips if the license is invalid or a sync is in progress, and otherwise calls `runSyncWithTracking(sm, { mode })`. Exports registerSyncSchedules and runScheduledSync. Never required by app.js.
     - (d) main.js boot sequence: step 2 also exits 1 when `config.syncSchedules.errors` is non-empty. Step 7 becomes `registerSyncSchedules(config.syncSchedules, syncStateManager)`, with the same per-tick semantics.
     - (e) app.js section: start() runs only when `require.main === module` (npm run sync-only). It resolves schedules (exit 1 if invalid), runs the startup license gate, registers the full/daily crons with the timezone behind a module-level in-progress flag, then runs one immediate full syncInventory(). Requiring app.js schedules nothing.
     - (f) Gotcha bullet "There are two cron schedulers": one per entry point. main.js registers through syncScheduler (SyncStateManager guard); app.js registers only when run directly (module flag). Note that until 2026-10, merely requiring app.js registered an extra unguarded full-load cron in every process, and that this is fixed. Keep the warning about double syncs when running both processes.

  5. Commit per D-7. Run `git add docs/DEPLOYMENT.md HANDOFF.md RUNBOOK.md ARCHITECTURE.md` only.
     - Subject: `docs: document daily-only schedule, SYNC_CRON_SCHEDULE=off and SYNC_TIMEZONE`.
     - Body: one line per file, then `Quick task: 261008-jdr`, a blank line, and the final line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
     - No push.
     - Do not touch README.md, .env / .env.example, CLAUDE.md, .claude/, or .planning/ content.
  </action>
  <verify>
    <automated>for f in docs/DEPLOYMENT.md HANDOFF.md RUNBOOK.md ARCHITECTURE.md; do grep -q "SYNC_DAILY_CRON_SCHEDULE" "$f" || echo "MISSING SYNC_DAILY_CRON_SCHEDULE in $f"; done; for f in docs/DEPLOYMENT.md HANDOFF.md ARCHITECTURE.md; do grep -q "SYNC_TIMEZONE" "$f" || echo "MISSING SYNC_TIMEZONE in $f"; done; grep -q "SYNC_DAILY_CRON_SCHEDULE=0 12,16,23" docs/DEPLOYMENT.md || echo "MISSING recipe in DEPLOYMENT"; grep -q "SYNC_CRON_SCHEDULE=off" docs/DEPLOYMENT.md || echo "MISSING off in DEPLOYMENT"; grep -q "SYNC_CRON_SCHEDULE=off" RUNBOOK.md || echo "MISSING off toggle in RUNBOOK"; grep -q "Completa: sin horario (manual)" docs/DEPLOYMENT.md || echo "MISSING boot line in DEPLOYMENT"; grep -q "Completa: sin horario (manual)" RUNBOOK.md || echo "MISSING boot line in RUNBOOK"; grep -q "syncScheduler" ARCHITECTURE.md || echo "MISSING syncScheduler in ARCHITECTURE"; git show --name-only --format= HEAD</automated>
    Expected: no `MISSING` lines, and the last command lists exactly the 4 docs.
  </verify>
  <done>
  - The four docs describe the three variables, the `off` toggle, the production recipe and the boot description line.
  - RUNBOOK §9.3 no longer recommends an invalid cron as a toggle.
  - The commit contains only the 4 docs, and each file keeps its own language.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Operator-edited `.env` → process boot | SYNC_* values are free text that decide when unattended writes to Fracttal happen |
| node-cron timer → sync engine | Automatic, unattended writes to the client's Fracttal tenant |
| License server → periodic gate | Unchanged, but it must stay in front of every scheduled run after the refactor |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-jdr-01 | E | `syncScheduler.runScheduledSync` (cron tick moved out of main.js) | mitigate | `await validate()` (periodic) + `isValid()` check before any run; syncInventory/syncInventoryMoved still re-validate internally; scheduler test asserts the skip; LicenseValidator.js untouched; no SYNC_* variable influences license checks |
| T-jdr-02 | T | Duplicate/concurrent Fracttal writes (app.js load-time cron, overlapping ticks) | mitigate | Remove load-time `start()` (regression test + Smoke A); `SyncStateManager.isInProgress()` guard in service mode; module-level flag in headless mode (overlap test) |
| T-jdr-03 | D | `resolveSyncSchedules` + main.js/app.js boot | mitigate | Invalid schedule or zone → exit 1 at boot with a message naming the variable, instead of a crash at an unpredictable time or a schedule that silently never fires (smokes in Tasks 1 and 2) |
| T-jdr-04 | D | Schedule drift with the Windows timezone (GitHub #3) | mitigate | Explicit `{ timezone }` on every `cron.schedule`, default America/Mexico_City; tests assert the option in both entry points |
| T-jdr-05 | I | Boot error messages echo values | accept | Only SYNC_* values (cron strings, zone names) are echoed, never secrets; output goes to local console / Servy logs |
| T-jdr-06 | R | Which load ran | mitigate | `mode` recorded on every tracked history entry (dashboard / `/api/sync/history`) |
</threat_model>

<verification>
Run from the repo root after all three tasks:
1. `npx jest --testPathIgnorePatterns fracttal.integration` → 11 suites green (7 baseline + 4 new), 0 failures. Never run `tests/integration/fracttal.integration.test.js`.
2. The three smokes (Task 1 main.js with an invalid zone → exit 1; Task 2 `require('./src/app')` → exit 0 promptly; Task 2 headless with an invalid cron → exit 1) behave as described.
3. `git log --oneline -3` shows the `feat(sync)`, `fix(app)` and `docs` commits. Each body contains `Quick task: 261008-jdr` and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
4. `git diff --name-only HEAD~3 HEAD` lists exactly the 15 files in files_modified. In particular it must not include `src/services/LicenseValidator.js`, `scripts/obfuscate.js`, `src/services/sageService.js`, `src/middleware/requireLicense.js`, `public/index.html`, `package.json`, `.env*`, `CLAUDE.md`, `.claude/` or `.planning/`.
5. `git status --short` shows only the 4 pre-existing untracked root .md files, plus the SUMMARY for this quick task, which the orchestrator commits. Nothing was pushed, and the branch is unchanged (or is the orchestrator's worktree branch).
</verification>

<success_criteria>
- Production recipe (`SYNC_CRON_SCHEDULE=off`, `SYNC_DAILY_CRON_SCHEDULE=0 12,16,23 * * *`, `SYNC_TIMEZONE=America/Mexico_City`, `SYNC_ON_STARTUP=false`) → the service schedules only the daily/delta load at 12:00, 16:00 and 23:00 Mexico time. The full load runs only on demand (dashboard / `npm run sync`).
- With the variables unset, behavior matches today (full at 02:00, no daily), now with an explicit timezone.
- Invalid values abort boot with a Spanish message naming the variable, in both main.js and headless app.js.
- Requiring app.js is side-effect free: no cron and no startup license gate. This removes the double 02:00 full run under the service.
- History entries record the mode, and the dashboard shows the one-line schedule description.
- Docs are updated, and RUNBOOK no longer suggests an invalid cron as a toggle.
- All tests are green.
</success_criteria>

<source_audit>
| Source | ID | Item | Task | Status |
|--------|----|------|------|--------|
| GOAL | — | Service schedules only the daily load (12/16/23 MX); full load manual | 1 (+3 recipe) | COVERED |
| CONTEXT | D-1 | SYNC_DAILY_CRON_SCHEDULE; SYNC_CRON_SCHEDULE off-values + default; SYNC_TIMEZONE; Spanish fail-fast before any cron.schedule | 1, 2 | COVERED |
| CONTEXT | D-2 | schedules.js / server.js / syncScheduler.js / main.js / syncController / syncStateManager layout; no UI change | 1 | COVERED |
| CONTEXT | D-3 | app.js start() only when require.main === module; headless full+daily with tz; module flag; immediate full run kept | 2 | COVERED |
| CONTEXT | D-4 | Resolver, scheduler, controller-mode/history and app-require tests; suite green without fracttal.integration | 1, 2 | COVERED |
| CONTEXT | D-5 | DEPLOYMENT .env + recipe, HANDOFF rows, ARCHITECTURE server.js row; no .env edits | 3 | COVERED |
| CONTEXT | D-6 | Do-not-touch list | all (verification 4) | COVERED |
| CONTEXT | D-7 | Atomic repo-style commits ending with Co-Authored-By, no push | 1, 2, 3 | COVERED |
| REQ | GH-3 | Explicit cron timezone | 1, 2 | COVERED |
| REQ | GH-9 | Headless overlap guard | 2 | COVERED |
| RESEARCH | — | None (no research phase) | — | N/A |

Planner discretion beyond the sources:
- SYNC_DAILY_CRON_SCHEDULE also accepts the off-values (symmetry).
- Internal whitespace is collapsed when values are normalized.
- `_startHeadless` is exported for tests only, with 3 headless tests (timezone, defaults, overlap) as evidence for #3 and #9.
- RUNBOOK lines 101 and 108 and §9.3 are updated, because the old §9.3 advice would now crash boot.
- ARCHITECTURE gets the rows and lines this change makes stale.
- The scheduler's license warning keeps the exact `License invalid — skipping scheduled sync` prefix for log-tail.
- Commit bodies carry `Quick task: 261008-jdr` (code-review scoping) and use `Refs #3/#9` rather than `Closes`, so the user decides when to close the issues.
</source_audit>

<output>
After completion, create `.planning/quick/261008-jdr-programar-solo-la-carga-diaria-en-el-ser/261008-jdr-SUMMARY.md` containing:
- the 3 commit hashes;
- test counts (suites/tests);
- the three smoke outputs;
- the exact production `.env` lines for the orchestrator to relay to the user: `SYNC_CRON_SCHEDULE=off`, `SYNC_DAILY_CRON_SCHEDULE=0 12,16,23 * * *`, `SYNC_TIMEZONE=America/Mexico_City`, `SYNC_ON_STARTUP=false`, followed by a service restart;
- any deviations;
- the remaining out-of-scope observation (the stale `.claude/agents/license-guard.md` location of the periodic gate).
</output>
