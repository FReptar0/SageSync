# Codebase Structure

**Analysis Date:** 2026-05-14

## Directory Layout

```
SageSync/
├── src/
│   ├── main.js                       # Full server entry: Express + cron + dashboard
│   ├── app.js                        # syncInventory() + headless cron entry
│   ├── sync.js                       # One-shot CLI sync (npm run sync)
│   ├── maintenance.js                # Operator CLI (logs, token, config)
│   ├── config/
│   │   ├── server.js                 # Port, cron schedule, pagination, log paths
│   │   ├── database.js               # mssql pool singleton + query() wrapper
│   │   ├── license.js                # License env triplet (URL, HMAC, API key)
│   │   ├── logger.js                 # Winston singleton, file + console
│   │   ├── configManager.js          # config.json + .fracttal-token persistence
│   │   └── server.js                 # (duplicate listing avoided)
│   ├── controllers/
│   │   ├── syncController.js         # POST /sync, GET /sync/status, /sync/history
│   │   ├── systemController.js       # GET /status, /test/connections
│   │   ├── sageController.js         # GET /sage/stats, /sage/inventory/:location?
│   │   ├── fracttalController.js     # GET /fracttal/warehouses
│   │   └── logsController.js         # GET /logs, /logs/stats, /logs/dates, /logs/test
│   ├── middleware/
│   │   ├── requireLicense.js         # 503 gate, reads LicenseValidator cache
│   │   └── errorHandler.js           # Global error handler + asyncHandler wrapper
│   ├── routes/
│   │   ├── index.js                  # Aggregator, mounted at /api in main.js
│   │   ├── systemRoutes.js           # /system/license (exempt) + /status + /logs/*
│   │   ├── syncRoutes.js             # /sync + /sync/status + /sync/history
│   │   ├── sageRoutes.js             # /sage/stats + /sage/inventory/:location?
│   │   ├── fracttalRoutes.js         # /fracttal/warehouses
│   │   └── logsRoutes.js             # Alternate /api/logs* path (legacy)
│   ├── services/
│   │   ├── LicenseValidator.js       # HMAC + freshness + 3-state cache (English)
│   │   ├── fracttalClient.js         # OAuth + axios interceptors + endpoints (Spanish)
│   │   ├── sageService.js            # MSSQL queries + location mapper (Spanish)
│   │   └── syncStateManager.js       # In-memory sync state + 10-entry history
│   └── utils/
│       ├── validateEnv.js            # Boot-time env validation (English)
│       └── logParser.js              # Tail/filter winston JSON logs for dashboard
├── scripts/
│   ├── obfuscate.js                  # javascript-obfuscator build for dist (CI)
│   ├── install-service.ps1           # Windows Service installer via Servy
│   └── setup-automap.js              # Generate config.json from Sage locations
├── tests/
│   ├── setup.js                      # Jest globals/env (loaded via setupFilesAfterEnv)
│   ├── services/
│   │   ├── LicenseValidator.test.js
│   │   ├── fracttalClient.test.js
│   │   └── sageService.test.js
│   ├── middleware/
│   │   └── requireLicense.test.js
│   ├── integration/
│   │   ├── fracttal.integration.test.js
│   │   └── licenseEnforcement.test.js
│   └── manual/                       # Node scripts (not Jest); ad-hoc operator tools
├── public/
│   └── index.html                    # Dashboard SPA (single-file, ~57 KB)
├── postman/                          # Saved Postman collection for Fracttal API
├── backups/                          # config.json snapshots from npm run maintenance:backup
├── logs/                             # Winston output + Servy stdio (gitignored)
├── dist/                             # Obfuscated build output (CI-pushed elsewhere)
├── .planning/                        # GSD planning artifacts
│   ├── PROJECT.md
│   ├── REQUIREMENTS.md
│   ├── MILESTONES.md
│   ├── ROADMAP.md
│   ├── STATE.md
│   ├── codebase/                     # THIS DIRECTORY (mapper output)
│   └── phases/
│       ├── 01-validator-core/
│       └── 02-enforcement-surface/
├── docs/
│   ├── DEPLOYMENT.md                 # 12-step client install (Spanish)
│   └── MEMORY.md                     # Historical decisions + API gotchas (Spanish)
├── .claude/                          # Project Claude Code config
│   ├── agents/                       # Subagent definitions
│   ├── commands/                     # Slash commands
│   └── skills/                       # Skill index
├── .github/workflows/
│   └── obfuscate-deploy.yml          # CI: obfuscate + push to SageSync-dist repo
├── package.json
├── package-lock.json
├── jest.config.js
├── config.json                       # Sage location → Fracttal warehouse mapping
├── .env                              # Secrets (never committed)
├── .fracttal-token                   # Persisted OAuth token (auto-generated, gitignored)
├── CLAUDE.md                         # Claude Code project instructions
├── HANDOFF.md                        # New-owner entry-point doc (Spanish)
├── ARCHITECTURE.md                   # Companion to .planning/codebase/ARCHITECTURE.md
├── RUNBOOK.md                        # Production operations (Spanish)
├── README.md
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── SECURITY.md
└── LICENSE.md
```

## Directory Purposes

**`src/`:**
- Purpose: All application source. No tests, no scripts, no docs.
- Contains: Three sibling entry points at the top level (`main.js`, `app.js`, `sync.js`), plus the `maintenance.js` CLI, then five subdirectories by role.
- Key files: `src/main.js`, `src/app.js`, `src/sync.js`.

**`src/config/`:**
- Purpose: Environment-driven configuration singletons. One file per concern.
- Contains: Server config, MSSQL pool, license env, winston logger, ConfigManager (config.json + token).
- Key files: `src/config/logger.js` (logger singleton, used everywhere), `src/config/configManager.js` (config.json loader, token I/O), `src/config/database.js` (mssql singleton).
- Convention: anything that touches an env var or a config file lives here. Service code never reads `process.env` directly except inside `FracttalClient` constructor.

**`src/services/`:**
- Purpose: Business logic and external integrations. Stateful where useful (LicenseValidator singleton, SyncStateManager instance).
- Contains: One class/module per external system or domain concern.
- Key files: `src/services/LicenseValidator.js`, `src/services/fracttalClient.js`, `src/services/sageService.js`, `src/services/syncStateManager.js`.
- Convention: services are constructed in `main.js` and hung off `app.locals` for controllers to read. `LicenseValidator` is a module singleton (functional API), not a class.

**`src/controllers/`:**
- Purpose: Express request handlers. One file per route group.
- Contains: `asyncHandler`-wrapped handlers that pull services from `req.app.locals`.
- Key files: `src/controllers/syncController.js` (also exports `runSyncWithTracking` used by main.js cron), `src/controllers/systemController.js`.
- Convention: thin wrappers — no business logic, just orchestrate calls to services and format the JSON response.

**`src/routes/`:**
- Purpose: `express.Router()` definitions, one per resource. `index.js` aggregates.
- Contains: One `router.METHOD(path, controller.handler)` per endpoint, plus the `/system/license` definition (which lives in `systemRoutes.js` directly because it bypasses controllers).
- Key files: `src/routes/index.js`, `src/routes/systemRoutes.js`.
- Convention: Route file imports its sibling controller by relative path and mounts handlers. Mounting order in `index.js` does not matter because all sub-routers attach at `/`.

**`src/middleware/`:**
- Purpose: Cross-cutting Express middleware.
- Contains: `requireLicense` (the 503 gate), `errorHandler` + `asyncHandler` (global error plumbing).
- Key files: `src/middleware/requireLicense.js`, `src/middleware/errorHandler.js`.

**`src/utils/`:**
- Purpose: Pure helpers that don't fit "service" or "config". No state, no I/O ownership.
- Contains: `validateEnv` (boot env check), `logParser` (filesystem read of winston JSON for dashboard).
- Key files: `src/utils/validateEnv.js`.

**`scripts/`:**
- Purpose: Build, install, and setup scripts not part of runtime.
- Contains: Obfuscator runner (CI), Windows Service installer (PowerShell + Servy), one-time setup utility for config.json.
- Generated: No.
- Committed: Yes (PowerShell script + JS scripts).

**`tests/`:**
- Purpose: Jest tests + manual operator scripts.
- Contains: `services/`, `middleware/`, `integration/` are Jest. `manual/` is plain Node scripts.
- Key files: `tests/setup.js` (Jest setup), per-service `*.test.js`.
- Convention: Jest test file lives in `tests/<layer>/<filename>.test.js` mirroring `src/<layer>/<filename>.js`. Co-located tests are not used.

**`public/`:**
- Purpose: Static assets served by Express after the license gate.
- Contains: A single dashboard SPA (`index.html`). No build pipeline, no bundler.

**`.planning/`:**
- Purpose: GSD planning artifacts. The mapper writes `.planning/codebase/`; planners write `.planning/phases/`.
- Contains: Project-level docs (`PROJECT.md`, `MILESTONES.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md`) and per-phase planning under `phases/`.
- Convention: Do not modify `PROJECT.md`, `MILESTONES.md`, `REQUIREMENTS.md`, `ROADMAP.md`. `STATE.md` is append-only.

**`docs/`:**
- Purpose: Reference docs for the new owner and ops. Companion to the top-level handoff docs.
- Contains: `DEPLOYMENT.md` (12-step install), `MEMORY.md` (decisions + gotchas).
- Convention: Spanish prose; tables where useful. Excluded from `dist/`.

**`logs/`:**
- Purpose: Winston output + Servy-captured stdio.
- Generated: Yes.
- Committed: No (gitignored).

**`dist/`:**
- Purpose: Obfuscated build output. Pushed to a separate `SageSync-dist` repo by CI.
- Generated: Yes.
- Committed: No (gitignored locally; lives in its own repo).

**`backups/`:**
- Purpose: `config.json` snapshots produced by `npm run maintenance:backup`.
- Generated: Yes (by operator action).
- Committed: No.

**`postman/`:**
- Purpose: Saved Postman collection used during Fracttal API discovery. Reference only — not part of any runtime.

## Key File Locations

**Entry Points:**
- `src/main.js` — full server: Express + cron + dashboard. Used by Windows Service / `npm start`.
- `src/app.js` — headless cron + reusable `syncInventory()`. Used by `npm run sync-only` and required by `sync.js` + `syncController.js`.
- `src/sync.js` — one-shot CLI. Used by `npm run sync` and by deployment scripts.
- `src/maintenance.js` — operator CLI. Used by `npm run maintenance*`.

**Configuration:**
- `.env` — secrets (DB credentials, Fracttal client id/secret, license HMAC + API key). Loaded by every entry point via `dotenv`.
- `config.json` — Sage location → Fracttal warehouse mapping, default warehouse, sync settings, warehouse auto-create settings. Loaded by `ConfigManager` from project root.
- `.fracttal-token` — persisted OAuth2 token. Auto-managed by `FracttalClient` + `ConfigManager`.
- `jest.config.js` — Jest test runner config.
- `src/config/server.js` — runtime config object (port, cron, pagination).

**Core Logic:**
- `src/app.js` — `syncInventory()`: the 3-case dispatch loop.
- `src/services/sageService.js` — Sage queries + location→warehouse mapper.
- `src/services/fracttalClient.js` — all Fracttal API calls + OAuth + axios interceptors. **Canonical methods:** `createInventoryWithWarehouse`, `associateItemToWarehouse`, `adjustInventoryStock`. Legacy methods (`createInventoryItem`, `updateWarehouseItem`, `createWarehouseItem`, `adjustInventory`, `updateInventoryAdjustment`) remain for compat but log `DEPRECATED` warnings.
- `src/services/LicenseValidator.js` — license validation singleton.

**Testing:**
- `tests/services/` — unit tests for each service.
- `tests/middleware/requireLicense.test.js` — middleware gate.
- `tests/integration/licenseEnforcement.test.js` — end-to-end license blocking against the express app.
- `tests/integration/fracttal.integration.test.js` — exercises FracttalClient against the sandbox.
- `tests/manual/test-workflow.js` — full E2E workflow against Fracttal sandbox (used by `npm run test:workflow` and the `/sync-local` slash command).

## Naming Conventions

**Files:**
- Source files: `camelCase.js` (e.g., `sageService.js`, `requireLicense.js`).
- Exceptions named in PascalCase only when the file exports a single class/module with a strong identity: `LicenseValidator.js`.
- Tests mirror the source filename + `.test.js`: `sageService.test.js`, `LicenseValidator.test.js`.
- Scripts: `kebab-case.js` (e.g., `install-service.ps1`, `setup-automap.js`).

**Directories:**
- Plural, lowercase: `services/`, `controllers/`, `routes/`, `middleware/`, `tests/`, `utils/`, `scripts/`, `logs/`, `docs/`.
- Exceptions: `src/` (the conventional source root), `.planning/`, `.github/`.

**Inside files — mixed Spanish/English by file age:**
- **Older files are Spanish** — variables, comments, error messages, log strings:
  - `src/app.js` — Spanish
  - `src/services/sageService.js` — Spanish
  - `src/services/fracttalClient.js` — Spanish
  - `src/services/syncStateManager.js` — Spanish
  - `src/maintenance.js` — Spanish
  - `src/config/configManager.js` — Spanish
  - `src/config/database.js` — Spanish
  - `src/config/logger.js` — Spanish
  - `src/controllers/*` — Spanish
  - `src/routes/*` — Spanish
  - `src/middleware/errorHandler.js` — Spanish
  - `src/utils/logParser.js` — Spanish
- **Newer v1.1 files are English** — variables, comments, log strings:
  - `src/services/LicenseValidator.js` — English
  - `src/middleware/requireLicense.js` — English
  - `src/utils/validateEnv.js` — English
  - `src/config/license.js` — English
- **Rule:** keep the file's language when editing. Do not mix within one file. **User-facing log messages remain Spanish across the codebase** (e.g., `'Licencia inactiva. Contacte a su proveedor.'`).

**Functions:**
- `camelCase` for both regular and async functions.
- License validator exports use leading underscore for private/test-only helpers (`_doValidate`, `_checkDns`, `_isPrivateOrLoopback`, `_buildResult`, `_reset`).

## Where to Add New Code

**A new sync case (e.g., "exists in different warehouse, transfer"):**
- Primary code: `src/app.js`, inside the `for (const sageItem of sageItems)` loop, alongside the existing `if/else if/else` chain. Add a new branch using `itemStatus` flags + any new Sage data you need to pull through.
- New FracttalClient method: `src/services/fracttalClient.js`. Follow the existing pattern — `try` → `logger.info` → `await this.client.METHOD(url, payload)` → `logger.info` → `return response.data` → `catch (error) { logger.error(...); throw error; }`. Do NOT add to the DEPRECATED block at the top; add in the "WAREHOUSE INVENTORY METHODS" section near `adjustInventoryStock`.
- Test: `tests/services/fracttalClient.test.js` (unit, mock axios) + a scenario in `tests/manual/test-workflow.js` (end-to-end against sandbox).

**A new HTTP endpoint:**
- Decide which resource group it belongs to (`system`, `sync`, `sage`, `fracttal`, `logs`). If new, add a new pair of files.
- Controller: `src/controllers/{resource}Controller.js`. Wrap the handler with `asyncHandler`, read services from `req.app.locals`.
- Route: `src/routes/{resource}Routes.js`. Add `router.METHOD('/path', controller.handler)`.
- Wire-up: if a new resource, add `router.use('/', newRoutes)` to `src/routes/index.js`. Existing resources need no wire-up change.
- Test: `tests/integration/{resource}.integration.test.js` if it touches a service; `tests/middleware/` if it's middleware-shaped.
- **License exemption:** if the new endpoint must work when license is invalid (operator emergency), add its path to the exemption wrapper in `src/main.js` (the `if (req.path === '/api/system/license') return next();` block). Otherwise it is automatically gated.

**A new test:**
- Unit test of a service or util: `tests/services/{name}.test.js` or `tests/middleware/{name}.test.js`. Match the source filename + `.test.js`.
- Integration test: `tests/integration/{name}.test.js`. Uses `supertest` for HTTP, may instantiate real or mocked services.
- Manual / sandbox script: `tests/manual/{name}.js`. Plain Node script invoked from `package.json` (`test:api`, `test:credentials`, `test:workflow`). These are NOT Jest tests — they call `node` directly and may take env from `.env`.
- Jest discovers `**/tests/**/*.test.js` and `**/tests/**/*.spec.js` automatically (`jest.config.js`).

**A new external integration (third API beyond Sage + Fracttal):**
- Service class: `src/services/{name}Service.js` or `{name}Client.js`. Mirror `FracttalClient` if it needs auth + interceptors, or `SageService` if it's a thin query wrapper.
- Config: extend `src/config/` with a new env loader if there are credentials. Add required vars to `src/utils/validateEnv.js` under a new key in `REQUIRED_VARS`.
- Wiring: instantiate in `src/main.js`, hang on `app.locals`.

**A new operator CLI task:**
- Add a method on `MaintenanceScript` in `src/maintenance.js`.
- Add a `case` to the `switch (command)` block at the bottom of the same file.
- Add an `"maintenance:<name>"` script entry in `package.json`.

**A new env var:**
- Add to `.env` (locally) — do NOT commit secrets.
- Add to `src/utils/validateEnv.js` `REQUIRED_VARS` under the right group.
- Document in `docs/DEPLOYMENT.md` if it's customer-facing.

## Special Directories

**`dist/`:**
- Purpose: Obfuscated build output. Generated by `scripts/obfuscate.js`.
- Generated: Yes.
- Committed: No (locally gitignored; lives in `SageSync-dist` repo, pushed by CI via `OBFUSCATED_REPO_TOKEN`).

**`logs/`:**
- Purpose: Winston `sagesync.log` + `error.log`, plus `servy-stdout.log` + `servy-stderr.log` in production.
- Generated: Yes (at runtime).
- Committed: No (gitignored).

**`backups/`:**
- Purpose: Timestamped `config.json` snapshots from `npm run maintenance:backup`.
- Generated: Yes (operator-triggered).
- Committed: No.

**`node_modules/`:**
- Generated: Yes.
- Committed: No.

**`.planning/codebase/`:**
- Purpose: GSD mapper output (this directory). Consumed by `/gsd-plan-phase` and `/gsd-execute-phase`.
- Generated: Yes (by `/gsd-map-codebase`).
- Committed: Yes (so other agents can read it).

**`.planning/phases/`:**
- Purpose: Per-phase planning artifacts (one subdirectory per phase, e.g., `01-validator-core/`, `02-enforcement-surface/`).
- Generated: Yes (by `/gsd-plan-phase`).
- Committed: Yes.

---

*Structure analysis: 2026-05-14*
