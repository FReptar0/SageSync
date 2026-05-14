# Architecture

**Analysis Date:** 2026-05-14

## Pattern Overview

**Overall:** Layered service (entry → license gate → middleware → routes/controllers → services → external systems). Single-tenant, on-premise Windows daemon. Cron-driven, with an Express HTTP surface mounted on top for dashboard + manual control.

**Key Characteristics:**
- **License-gated, in-band.** A `LicenseValidator` singleton fronts everything: the boot sequence exits on failed startup validation, every cron tick re-validates, and a synchronous cache feeds the `requireLicense` Express middleware. There is no separate enforcement process.
- **One-way ETL.** Sage300 MSSQL is the source of truth (read-only); Fracttal REST is the destination. Inventory flows Sage → Fracttal only.
- **Three-case dispatch is the heart of the sync.** Every Sage row is classified as "exists+in warehouse", "exists not in warehouse", or "new" before any write call. The dispatch lives in `src/app.js`.
- **Two execution modes** off the same `syncInventory()` function: full server (`src/main.js` — Express + cron + dashboard) or headless (`src/app.js` cron-only) or one-shot CLI (`src/sync.js`).
- **Token persistence on disk.** OAuth2 access + refresh tokens are written to `.fracttal-token` and re-loaded on boot so cron ticks survive restarts without re-authenticating.
- **Per-item resilience.** A single bad row never aborts a sync; the outer try/catch in the `for` loop increments an `errors` counter and continues.

## Layers

**Entry / Bootstrap:**
- Purpose: Validate env vars, gate the license, wire services into Express + cron, start listening.
- Location: `src/main.js`, `src/app.js`, `src/sync.js`
- Contains: Startup orchestration, signal handlers, cron scheduling, initial sync trigger.
- Depends on: `utils/validateEnv`, `services/LicenseValidator`, every other layer.
- Used by: `npm start`, `npm run sync-only`, `npm run sync`, Windows Service (Servy).

**License Gate:**
- Purpose: Block the entire process when the remote license server says the install is inactive, expired, or revoked.
- Location: `src/services/LicenseValidator.js`, `src/middleware/requireLicense.js`, `src/config/license.js`
- Contains: HMAC verification, timestamp freshness (5 min window, 60s future tolerance), 3-state cache (VALID/INVALID/ERROR), 24h ERROR TTL, exponential-backoff startup retry, DNS bypass detection, the 503 middleware.
- Depends on: `axios` (dedicated `licenseClient` instance), `crypto`, `dns`, env vars (`LICENSE_API_URL`, `HMAC_SECRET`, `SAGESYNC_API_KEY`).
- Used by: `main.js` (startup + cron + middleware), `app.js` (cron + sync), `sync.js` (CLI), `routes/systemRoutes.js` (`/api/system/license` exposes `getStatus()`).

**HTTP Surface (Routes + Controllers + Middleware):**
- Purpose: Dashboard, manual sync, system status, log browser, Sage stats, Fracttal warehouse query.
- Location: `src/routes/`, `src/controllers/`, `src/middleware/`
- Contains: `express.Router()` definitions, `asyncHandler`-wrapped handlers that read services off `req.app.locals`, global error handler.
- Depends on: services layer (via `req.app.locals.sage`, `req.app.locals.fracttal`, `req.app.locals.syncStateManager`), `LicenseValidator.getStatus()` for `/api/system/license`.
- Used by: `public/index.html` (the dashboard SPA), `npm run sync` POST clients.

**Services (Business Logic):**
- Purpose: Encapsulate Sage SQL access, Fracttal REST access, sync state tracking, license validation.
- Location: `src/services/`
- Contains: `SageService` (MSSQL queries + location→warehouse mapper), `FracttalClient` (OAuth, axios interceptors, all Fracttal endpoints), `LicenseValidator` (singleton), `SyncStateManager` (in-memory sync state + 10-entry history).
- Depends on: `src/config/database.js` (mssql pool), `src/config/configManager.js` (config.json + token persistence), `src/config/logger.js` (winston singleton).
- Used by: `app.js` `syncInventory()`, every controller via `req.app.locals`.

**Configuration:**
- Purpose: Centralize env-driven config and external state files.
- Location: `src/config/`
- Contains: `server.js` (port, cron, pagination), `database.js` (mssql pool singleton), `license.js` (license env triplet), `logger.js` (winston singleton, file + console transports), `configManager.js` (loads `config.json`, persists `.fracttal-token`).
- Depends on: `dotenv` (loaded everywhere via `require('dotenv').config()`).
- Used by: every other layer.

**External Systems:**
- Sage300 — `COPDAT.dbo.ICILOC ⋈ ICITEM` read via `mssql` pool. SELECT-only.
- Fracttal REST API — `https://app.fracttal.com/api`. OAuth2 client_credentials grant against `https://one.fracttal.com/oauth/token`.
- License server — `LICENSE_API_URL/api/validate?key=...`, HMAC-SHA256 signed responses.

## Data Flow

**Inventory Sync (the main tick):**

1. Cron fires (`SYNC_CRON_SCHEDULE`, default `0 2 * * *`). In `main.js` the handler is anonymous and wraps `runSyncWithTracking(syncStateManager)` from `controllers/syncController.js`; in `app.js` the handler is `syncInventory` directly.
2. `LicenseValidator.validate()` runs without the `{startup:true}` flag — periodic re-validation, never exits. If `isValid()` is false after the call, the tick is skipped (`main.js` logs "License invalid — skipping scheduled sync"; `app.js` logs "License invalid — aborting sync").
3. `configManager.validateConfig()` asserts that `config.json` has `locationMapping` and a `defaultWarehouse`.
4. `sage.validateConnection()` runs `SELECT 1` against MSSQL; `fracttal.getAccessToken()` loads/refreshes the OAuth token from `.fracttal-token`.
5. `sage.getAllInventoryItems()` runs the hard-coded SELECT from `src/services/sageService.js` against `COPDAT.dbo.ICILOC ⋈ ICITEM` with `INACTIVE = 0 AND STOCKITEM = 1 AND LOCATION = 'GRAL'`. Returns `{ItemNumber, Description, Location, QuantityOnHand, MinimumStock, StandardCost, RecentCost, LastCost}[]`.
6. For each row, `sage.mapSageLocationToFracttalWarehouse(location, itemCode, description)` walks `config.json.locationMapping` plus optional `specialRules` (keyword match against description/code) to pick a Fracttal warehouse code. Returns `null` if no mapping exists → row is skipped with a warn.
7. `fracttal.ensureWarehouseExists(warehouseCode)` does a GET on `/warehouses/{code}`; on 404, creates it via POST `/warehouses/` using `config.json.warehouseCreationSettings`.
8. `fracttal.checkItemExistsInWarehouse(itemCode, warehouseCode)` does GET `/items/{code}` and inspects the `warehouses[]` array on the response to compute `{exists, inWarehouse}`.
9. **Three-case dispatch** (see "Key Abstractions" below).
10. Per-item errors are caught at the loop boundary, increment `errors`, and `continue`. Progress is logged every 100 items.
11. On completion, a summary `{totalItems, processedItems, updatedItems, createdItems, errors, warehousesCreated}` is logged. In `main.js` mode the summary is also stored in `syncStateManager.history` (capped at 10 entries) and exposed via `GET /api/sync/status` and `/api/sync/history`.

**License Validation (separate flow, runs in-band):**

1. Boot: `validateEnv()` ensures `LICENSE_API_URL`, `HMAC_SECRET`, `SAGESYNC_API_KEY`, DB vars, Fracttal vars are present — exits with code 1 if any are missing.
2. Startup gate: `validateLicense({startup: true})` runs once. On non-VALID result, retries 3× with backoff 1s/2s/4s. After exhausting retries, calls `process.exit(1)`.
3. Each validation attempt: optional DNS bypass check (`dns.resolve4`, warns on RFC1918/loopback, non-blocking) → GET `{apiUrl}/api/validate?key={apiKey}` with 10s timeout → HMAC-SHA256 signature check using constant-time compare → freshness check (5 min window, 60s future tolerance) → state transition.
4. State machine: `VALID` → operate. `INVALID` → 503 on every route, no sync. `ERROR` (network/HMAC fail) → keep prior cached state for up to 24h since `lastSuccessfulCheck`; after TTL, demote to `INVALID`.
5. `requireLicense` middleware reads `isValid()` synchronously per request; on false, returns `503 {error, state}`. The `/api/system/license` path is exempted by the wrapper in `main.js` (not inside the middleware) so status is always visible.

**State Management:**
- `LicenseValidator` — singleton module state (`cachedState` object). Reset only by `_reset()` for tests.
- `SyncStateManager` — single instance per `main.js` process; in-memory only. Lost on restart. Tracks `inProgress`, stats, last result, last 10 results.
- OAuth token — persisted to `.fracttal-token` (gitignored). Auto-loaded by `FracttalClient.authenticate()`; auto-refreshed when within 5 min of expiry.

## Key Abstractions

**The three-case dispatch in `syncInventory()`:**
- Purpose: Decide which Fracttal endpoint(s) to call for a Sage row given the current state of Fracttal.
- Examples: `src/app.js` lines 99–139.
- Pattern:
  - **Case A — `exists && inWarehouse`** → `fracttal.adjustInventoryStock(itemCode, adjustmentData)` only. (`PUT /inventories_adjustment/{code}`)
  - **Case B — `exists && !inWarehouse`** → `fracttal.associateItemToWarehouse(itemCode, warehouseCode, {stock: 0, ...})` then `fracttal.adjustInventoryStock(itemCode, adjustmentData)`. (`POST /inventories_associate_warehouse/` then `PUT /inventories_adjustment/{code}`)
  - **Case C — `!exists`** → `fracttal.createInventoryWithWarehouse(createData)` then `fracttal.adjustInventoryStock(itemCode, adjustmentData)`. (`POST /inventories/` then `PUT /inventories_adjustment/{code}`)
- Case B and C are **two-call sequences** by design — Fracttal does not accept the stock value at creation/association time, so a follow-up adjustment is mandatory.

**`LicenseValidator` 3-state cache:**
- Purpose: Distinguish "remote says NO" from "we can't reach remote" so transient network blips do not lock the customer out.
- Examples: `src/services/LicenseValidator.js`.
- Pattern: A module-level `cachedState` object with fields `{state, active, expiresAt, lastChecked, lastSuccessfulCheck, error}`. State transitions only happen inside `_doValidate()`. Two read accessors are exported: `isValid()` (boolean, synchronous, used by middleware) and `getStatus()` (full object, synchronous, used by the status endpoint).

**`FracttalClient` axios interceptors:**
- Purpose: Auto-inject bearer token on every request; transparently refresh + retry once on 401; surface `UNAUTHORIZED_ENDPOINT` (module-not-enabled) as a distinct error type so callers can give a clear message instead of looping forever.
- Examples: `src/services/fracttalClient.js` lines 27–100.
- Pattern: Request interceptor calls `getAccessToken()` (which lazy-refreshes if within 5 min of expiry). Response interceptor: if status 401 with body `message === 'UNAUTHORIZED_ENDPOINT'`, throw with `isUnauthorizedEndpoint = true` (no retry); else on plain 401, clear token, re-auth, retry the request once with `_retry` flag to prevent loops.

**`SageService.mapSageLocationToFracttalWarehouse()`:**
- Purpose: Resolve Sage location code → Fracttal warehouse code with optional keyword-based special rules.
- Examples: `src/services/sageService.js` lines 167–204.
- Pattern: Lookup `config.locationMapping[sageLocation]` → if `specialRules` array exists, iterate and match keywords (case-insensitive) against item description or item code, return first match's `fracttalWarehouseCode`; else return the location's default `fracttalWarehouseCode`. Returns `null` on no mapping → caller skips the row.

**`asyncHandler` wrapper:**
- Purpose: Forward async rejections from controllers to the global Express error handler so individual handlers don't need their own try/catch.
- Examples: `src/middleware/errorHandler.js` lines 46–50.
- Pattern: `(fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)`. Every controller export is wrapped at definition time.

**`SyncStateManager`:**
- Purpose: In-memory tracking of "is a sync running right now?" + last-10-runs history. Used by the dashboard and by the cron handler to skip overlapping syncs.
- Examples: `src/services/syncStateManager.js`.
- Pattern: Plain JS class, single instance lives on `app.locals.syncStateManager`. `startSync()` flips `inProgress` and throws if already true. `endSync()` records result and history, capped at 10 entries.

## Entry Points

**`src/main.js` — full server (`npm start`):**
- Triggers: Servy-managed Windows Service in production, `npm start` in dev.
- Responsibilities: Boot validation → license startup gate → Express app construction (with the gate ordering rules below) → cron registration → HTTP listen on `process.env.PORT || 3000` → graceful shutdown handlers.
- Mounts dashboard at `/` (static `public/index.html`) and API at `/api`. Cron schedule from `process.env.SYNC_CRON_SCHEDULE`.

**`src/app.js` — headless cron (`npm run sync-only`):**
- Triggers: `npm run sync-only`, occasionally used in headless deployments where no dashboard is needed.
- Responsibilities: `validateEnv` → license startup gate → register cron at `SYNC_CRON_SCHEDULE` → if invoked as main module, run one `syncInventory()` immediately. No Express, no HTTP listener.
- Exports `syncInventory` so the function is reused by `controllers/syncController.js` and by `src/sync.js`.

**`src/sync.js` — one-shot CLI (`npm run sync`):**
- Triggers: Deployment scripts, manual operator runs, scheduled OS-level task if cron is not desired.
- Responsibilities: `validateEnv` → license startup gate → call `syncInventory()` once → `process.exit(0)` on success, `process.exit(1)` on error. Pure imperative wrapper.

**`src/maintenance.js` — operator CLI (`npm run maintenance*`):**
- Triggers: `npm run maintenance`, `maintenance:clean`, `maintenance:token`, `maintenance:backup`.
- Responsibilities: Clean logs older than 30 days, validate config.json, check token expiry, dump system info, force token renewal, snapshot config.json into `backups/`.

## Error Handling

**Strategy:** Defense-in-depth, with per-layer escalation:
- Boot-time errors (missing env, bad license) → `process.exit(1)` — fail fast and loud.
- Per-item sync errors → caught at loop boundary, counted, logged, sync continues.
- HTTP errors → global `errorHandler` middleware classifies operational/validation/db-unavailable/generic and returns appropriate status.
- Service-level errors → log with context (`error.response?.data || error.message`), rethrow to caller. Never swallow.

**Patterns:**
- **Per-item resilience.** `src/app.js` lines 53–155: outer `for` loop has its own `try/catch (itemError) { errors++; logger.error(...); continue; }`.
- **Service try/catch + rethrow.** Every Fracttal/Sage method follows: `try { ... } catch (error) { logger.error('Spanish message:', error.response?.data || error.message); throw error; }`. Never swallow.
- **Operational vs. unknown errors.** `errorHandler` distinguishes `error.isOperational` (returns the error's own `statusCode` + `message`), `ValidationError` (400), `ECONNREFUSED`/`ETIMEDOUT` (503), and falls through to a generic 500.
- **`asyncHandler` wraps every controller** so a rejected promise lands in the global handler instead of crashing the process.
- **License network failures degrade gracefully** for 24h. After `lastSuccessfulCheck + 24h` with no successful re-validation, ERROR → INVALID and traffic stops.

## Cross-Cutting Concerns

**Logging:** `winston` singleton from `src/config/logger.js`. Two file transports (`logs/sagesync.log` info+, `logs/error.log` error-only), each 10MB × 5 rotation. Console transport added when `NODE_ENV !== 'production'`. Default format is JSON with timestamp + stack. Service tag `{ service: 'sagesync' }` on every record.

**Validation:** `validateEnv()` at boot, `configManager.validateConfig()` per sync. Input validation in controllers is hand-rolled (`isValidDate`, pagination bounds checks).

**Authentication:**
- *Outbound to Fracttal:* OAuth2 client_credentials. Token persisted to `.fracttal-token`. Refresh logic in `FracttalClient.getAccessToken()` and the 401 response interceptor.
- *Inbound to Express:* none — the dashboard assumes localhost / private network. License is the only enforcement layer.

**License gate ordering (`src/main.js`):**
The order of middleware mounting in `main.js` is load-bearing — changing it breaks enforcement. The fixed sequence is:
1. `validateEnv()` — synchronous, exits on missing vars.
2. `await validateLicense({startup: true})` — startup gate.
3. `app = express()`, `app.use(express.json())`.
4. `requireLicense` wrapper that exempts `/api/system/license` and delegates to the middleware.
5. `express.static(public)` — mounted **after** the license gate so the dashboard is also blocked when invalid.
6. Service instantiation, `app.locals.*` wiring, `cron.schedule(...)`.
7. Route mounting (`app.use('/api', apiRoutes)`).
8. `errorHandler` last.

**Configuration discovery:** `config.json` is loaded by `ConfigManager` from project root at construction time. `.env` is loaded by `dotenv` everywhere via `require('dotenv').config()`. Both are required at boot.

---

*Architecture analysis: 2026-05-14*
