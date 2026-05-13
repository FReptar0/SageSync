# SageSync — Architecture Reference

Code-facing architecture document. English by convention. Pair this with the actual source while reading.

For "why does it look like this", see [`docs/MEMORY.md`](./docs/MEMORY.md). For "how do I run / operate it", see [`HANDOFF.md`](./HANDOFF.md) and [`RUNBOOK.md`](./RUNBOOK.md).

---

## 1. High-level overview

SageSync is a Node.js service that runs on-premise on a Windows server at each Tersoft client site. It performs **one-way synchronization** of inventory from Sage300 (MSSQL ERP) to Fracttal (cloud asset-management platform).

```
+----------------+        +-------------------------------------------------+
|                |        |  Windows Server (client site)                   |
|   Sage300      |        |                                                 |
|   (MSSQL)      |<-1433--|  +----------------------------------------+     |
|   COPDAT.dbo   |        |  |  SageSync (node)                       |     |
|   ICILOC,      |        |  |                                        |     |
|   ICITEM       |        |  |  +-----------+   +----------------+    |     |
|                |        |  |  | Sage      |   | FracttalClient |    |     |
+----------------+        |  |  | Service   |   | (axios + OAuth)|    |     |
                          |  |  +-----+-----+   +--------+-------+    |     |
                          |  |        |                  |             |     |     +---------------------+
                          |  |        v                  v             |     |     |                     |
                          |  |  +---------------------------------+    |     |     |  Fracttal API       |
                          |  |  | app.js / syncInventory()        |----|-----|-443->|  app.fracttal.com   |
                          |  |  |   - read Sage rows              |    |     |     |  one.fracttal.com   |
                          |  |  |   - map locations -> warehouses |    |     |     |  (OAuth + REST)     |
                          |  |  |   - create/associate/adjust     |    |     |     +---------------------+
                          |  |  +---------------------------------+    |     |
                          |  |             ^                            |     |
                          |  |             | cron tick                  |     |
                          |  |             |                            |     |
                          |  |  +---------------------------------+     |     |     +-----------------------------+
                          |  |  | main.js (Express + cron)        |-----|-----|-443->| sageconnect-license.        |
                          |  |  |   - license startup gate        |     |     |     | vercel.app                  |
                          |  |  |   - requireLicense middleware   |     |     |     | (HMAC-signed JSON)          |
                          |  |  |   - dashboard at :3000          |<- 60s poll -+    +-----------------------------+
                          |  |  +---------------------------------+     |     |
                          |  |             |                            |     |
                          |  |             v                            |     |
                          |  |  public/index.html (dashboard)           |     |
                          |  +----------------------------------------+     |
                          +-------------------------------------------------+
```

Sync runs on a cron schedule (default `0 2 * * *` — 2 AM daily) and can also be triggered manually via `POST /api/sync` or by running `npm run sync` on the box. The license gate sits in front of every operational path; a single global state cache decides whether anything runs at all.

---

## 2. Layer breakdown

### `src/config/` — configuration adapters

| File | Purpose | Public surface |
|------|---------|----------------|
| `configManager.js` | Loads `config.json` (Sage → Fracttal location mapping), persists `.fracttal-token` | `getLocationMapping`, `getAllLocationMappings`, `getDefaultWarehouse`, `getSyncSettings`, `getWarehouseCreationSettings`, `saveToken`, `loadToken`, `clearToken`, `validateConfig` |
| `database.js` | MSSQL connection pool singleton | `query(text, params)`, `testConnection()`, `connect()`, `disconnect()` |
| `license.js` | Reads `LICENSE_API_URL`, `HMAC_SECRET`, `SAGESYNC_API_KEY` from env | `{ apiUrl, hmacSecret, apiKey }` |
| `logger.js` | Winston singleton with rotation + JSON format | `info`, `warn`, `error`, `debug` |
| `server.js` | Reads `PORT`, `SYNC_CRON_SCHEDULE`, `SYNC_ON_STARTUP`, log/pagination defaults | `{ port, syncSchedule, syncOnStartup, logs, pagination }` |

### `src/middleware/`

| File | Purpose |
|------|---------|
| `errorHandler.js` | Global Express error handler + `asyncHandler` wrapper for routes |
| `requireLicense.js` | Synchronous license gate — returns 503 with `{ error, state }` when `isValid()` is false |

### `src/routes/` — Express routers

All routers are mounted at `/api`. The order matters: `requireLicense` wraps everything except `/api/system/license` (exemption is enforced in `main.js`, not in the middleware).

| File | Endpoints |
|------|-----------|
| `index.js` | Composes all routers under `/api` |
| `systemRoutes.js` | `GET /system/license` (always accessible), `GET /status`, `GET /test/connections`, `GET /logs*` |
| `syncRoutes.js` | `POST /sync`, `GET /sync/status`, `GET /sync/history` |
| `sageRoutes.js` | `GET /sage/stats`, `GET /sage/inventory/:location?` |
| `fracttalRoutes.js` | `GET /fracttal/warehouses` |
| `logsRoutes.js` | Duplicate logs routes under `/api/api/logs*` — legacy, harmless; the primary path is via `systemRoutes` |

### `src/controllers/`

| File | Owns |
|------|------|
| `systemController.js` | `/api/status` (composite health), `/api/test/connections` |
| `syncController.js` | `/api/sync` (kicks off background sync), `/api/sync/status`, `/api/sync/history`. Exports `runSyncWithTracking(syncStateManager)` used by the cron in `main.js` |
| `sageController.js` | `/api/sage/*` — stats + paginated inventory reads |
| `fracttalController.js` | `/api/fracttal/warehouses` — passes through |
| `logsController.js` | `/api/logs*` — date filtering, stats, debug `/api/logs/test` |

### `src/services/` — business logic

| File | Responsibility |
|------|----------------|
| `LicenseValidator.js` | Singleton; HMAC-SHA256 verification, freshness window 5 min, 24h ERROR TTL, DNS bypass detection. Exports: `validate({startup?})`, `isValid()`, `getStatus()`, `_reset()` |
| `sageService.js` | MSSQL queries against `COPDAT.dbo.ICILOC ⋈ ICITEM`. Filters `INACTIVE=0 AND STOCKITEM=1 AND LOCATION='GRAL'` in the default query. Exports `getAllInventoryItems`, `getInventoryItemsByLocation`, `getInventoryItemByCode`, `getUniqueLocations`, `getInventoryStats`, `mapSageLocationToFracttalWarehouse`, `transformToFracttalFormat`, `validateConnection`, `getConnectionInfo` |
| `fracttalClient.js` | Axios-based REST client + OAuth2 lifecycle + token persistence. ~30 methods. Critical group: `createInventoryWithWarehouse`, `associateItemToWarehouse`, `adjustInventoryStock`, `getWarehouseStock`, `getItemInventory`, `createWarehouseEntry`, `createWarehouseExit`, `checkItemExistsInWarehouse`, `ensureWarehouseExists`, `createWarehouse` |
| `syncStateManager.js` | In-memory state of sync execution (inProgress, stats, lastResult, history of last 10). Exported as a class, instantiated once in `main.js` and stored on `app.locals.syncStateManager` |

### `src/utils/`

| File | Purpose |
|------|---------|
| `validateEnv.js` | Asserts all required env vars present at boot; exits with code 1 listing every missing var |
| `logParser.js` | Reads & parses winston JSON or plain log lines into a structured response for the dashboard |

### `src/main.js` — Server entry point

Boot sequence (top-to-bottom):

1. Require deps & config.
2. `validateEnv()` → exits if any required env var missing.
3. `startServer()`:
   1. `validateLicense({ startup: true })` — retries 3× with backoff, exits on failure.
   2. Build Express app.
   3. Mount `express.json()`.
   4. Mount `requireLicense` wrapper that exempts `/api/system/license`.
   5. Mount `express.static(public/)`.
   6. Instantiate `SageService`, `FracttalClient`, `SyncStateManager` and attach to `app.locals`.
   7. Schedule cron: each tick re-validates license (no exit on failure, just skip), then calls `runSyncWithTracking()` if not already in progress.
   8. Mount `/` → static `index.html`, `/api` → all routers.
   9. Mount `errorHandler` (must be last).
   10. `app.listen(port)`.
   11. Optional: `setTimeout(() => runSyncWithTracking, 5000)` if `SYNC_ON_STARTUP=true`.
4. SIGINT / SIGTERM handlers for graceful shutdown.

### `src/app.js` — Sync orchestrator + standalone cron

Same `validateEnv` + `validateLicense` startup as `main.js`, but **no Express**. Exports `syncInventory()` which:

1. Re-validates license (periodic, no startup retries).
2. `configManager.validateConfig()`.
3. `sage.validateConnection()` + `fracttal.getAccessToken()`.
4. `sage.getAllInventoryItems()` — pulls every active stock item.
5. For each item: map location → warehouse → ensure warehouse exists → check item existence → apply one of three cases (see §3.4).
6. Return summary `{ totalItems, processedItems, updatedItems, createdItems, errors, warehousesCreated }`.

Also has a `start()` that schedules a cron + runs `syncInventory()` directly when invoked as `require.main === module`. This is what `npm run sync-only` triggers.

### `src/sync.js` — One-shot CLI

Tiny wrapper. `validateEnv()` → `validateLicense({ startup: true })` → `syncInventory()` → `process.exit(0|1)`. Used for manual loads and `setup-automap` post-flows.

### `src/maintenance.js`

CLI utility. Subcommands: `clean-logs`, `renew-token`, `backup-config`. Without subcommand runs `cleanLogs + validateConfiguration + checkTokenStatus + displaySystemInfo`.

---

## 3. Lifecycles

### 3.1. Bootstrap (`npm start` → `node src/main.js`)

```
validateEnv → validateLicense(startup:true) → express app → static + license gate
            → app.locals services → cron.schedule → app.listen → optional initial sync
```

A failure at any stage exits with code 1. Servy (production) will restart up to 5 times before giving up; in practice this is almost always a missing env var or revoked license.

### 3.2. Cron tick

```
node-cron fires → validateLicense() (no startup) → isValid()? → syncStateManager.inProgress?
                → runSyncWithTracking(syncStateManager) → SyncStateManager.startSync()
                → syncInventory() → endSync() with summary or error
```

If the previous run is still in progress, the new tick is logged and skipped — no parallel syncs.

### 3.3. Manual sync (`POST /api/sync`)

```
syncController.manualSync → check inProgress → 409 if so
                          → kick off runSyncWithTracking() (NOT awaited)
                          → respond 200 immediately with { message, inProgress:true }
```

The client (dashboard) polls `GET /api/sync/status` to follow progress.

### 3.4. The three sync cases (per item)

Implemented in `src/app.js`. For each Sage item:

- **Case A — Item exists + already in the target Fracttal warehouse**
  → `fracttal.adjustInventoryStock(itemCode, adjustmentData)` (PUT `/inventories_adjustment/{code}`)
  → counter `updatedItems++`
- **Case B — Item exists but NOT in this warehouse**
  → `fracttal.associateItemToWarehouse(itemCode, warehouse, {...})` (POST `/inventories_associate_warehouse/`)
  → followed by `fracttal.adjustInventoryStock(...)`
  → counter `createdItems++`
- **Case C — Item doesn't exist**
  → `fracttal.createInventoryWithWarehouse({...})` (POST `/inventories/`) — creates the asset AND associates it to the warehouse in one call
  → followed by `fracttal.adjustInventoryStock(...)` to set actual stock (initial stock from `/inventories/` is always 0)
  → counter `createdItems++`

Individual errors do not abort the loop — they increment `errors` and are logged. The summary is written via winston at the end.

> Historical note: pre-February-2026, the code used `POST /items/` which created **orphan assets** with no warehouse. That bug is what produced the v1.1 fix. See `docs/MEMORY.md`.

### 3.5. License validation lifecycle

Three independent triggers, one cached state:

- **Startup gate (`validate({startup:true})`)** in `main.js`, `app.js`, `sync.js`. 3 retries with exponential backoff (1s, 2s, 4s). Exits with code 1 on final failure.
- **Periodic re-validation (`validate()` without `startup`)** at the top of every cron tick. Failure becomes a skipped tick + warning, never an exit.
- **Status endpoint (`getStatus()`)** synchronous, no HTTP, returns the cached state for `GET /api/system/license` and the frontend banner poller.

State machine (in `LicenseValidator.cachedState.state`):

```
       startup or cron tick
           |
           v
       _doValidate()
           |
        +--+--+
        |     |
   (HTTP ok)  (HTTP error / bad sig / stale ts)
        |     |
        v     v
    ----------------+
    | active=true  | --> VALID  (cache lastSuccessfulCheck=now)
    | active=false | --> INVALID (cache lastSuccessfulCheck=now)
    | error/bad    | --> ERROR  (if last successful > 24h ago, demote to INVALID)
    ----------------+
```

`isValid()` returns `true` iff `state === 'VALID'`.

---

## 4. State

| Where | Lives in | Survives restart? | Notes |
|-------|----------|:-----------------:|-------|
| `.fracttal-token` | Filesystem (repo root) | Yes | OAuth2 access + refresh + `expires_at`. Gitignored. Auto-rewritten on every `authenticate()` / `refreshAccessToken()`. |
| LicenseValidator cache | Process memory | No | `cachedState`. Reset on restart; re-populated at startup gate. |
| `SyncStateManager` | Process memory | No | Last 10 sync summaries. Reset on restart. |
| `logs/sagesync.log`, `logs/error.log` | Filesystem | Yes (rotated) | Winston, 10MB × 5 files. |
| `config.json` | Filesystem | Yes | Sage→Fracttal mapping. Edited by `setup-automap.js` or manually. |
| `.env` | Filesystem | Yes | Secrets. Never committed. |

---

## 5. External integrations

### 5.1. Sage300 (read-only MSSQL)

- Driver: `mssql` v10. Pool max 10 idle 30s, connection+request timeouts 60s.
- Connection params from env: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, optional `DB_ENCRYPT`, `DB_TRUST_SERVER_CERTIFICATE`.
- Main tables: `COPDAT.dbo.ICILOC` (per-warehouse stock) joined with `COPDAT.dbo.ICITEM` (catalog). Filtered by `I.INACTIVE = 0 AND I.STOCKITEM = 1`.
- The default `sageService.inventoryQuery` filters `B.LOCATION = 'GRAL'` (legacy default — `getInventoryItemsByLocation()` overrides this for explicit location queries).
- No writes back to Sage. Ever.

### 5.2. Fracttal REST API

- Base: env `FRACTTAL_BASE_URL` (typically `https://app.fracttal.com/api`).
- OAuth2 (`client_credentials`): `FRACTTAL_OAUTH_URL` = `https://one.fracttal.com/oauth/token`. Token stored to `.fracttal-token`, refreshed when within 5 minutes of expiry. Token lifetime ~2 hours.
- Two-tier interceptors:
  - **Request interceptor:** stamps `Authorization: Bearer <token>`, refreshing if needed.
  - **Response interceptor:** detects `UNAUTHORIZED_ENDPOINT` (module not enabled) and short-circuits with `error.isUnauthorizedEndpoint = true`; otherwise on 401 it retries once with a fresh token.
- Endpoint cheat-sheet (post-Feb-2026 canonical):

  | Purpose | Method + Path |
  |---------|---------------|
  | Create item + warehouse association (initial stock = 0) | `POST /inventories/` |
  | Associate existing item to a warehouse | `POST /inventories_associate_warehouse/` |
  | Adjust stock / cost / min / max | `PUT /inventories_adjustment/{code}` |
  | Query item + its warehouses | `GET /inventories/{code}` |
  | Query all items in a warehouse | `GET /warehouses_items?code={warehouseCode}` |
  | Create a warehouse | `POST /warehouses/` |
  | Get a warehouse by code | `GET /warehouses/{code}` |
  | Receive goods | `POST /warehouse_entries_orders/{warehouseCode}` |
  | Issue goods | `POST /warehouse_outputs_orders/` |

  `POST /items/`, `PUT /items/{code}`, `adjustInventory()` and similar are kept in the client as deprecated methods for back-compat — **do not use them for new code**.

### 5.3. sageconnect-license server

- Endpoint: `GET <LICENSE_API_URL>/api/validate?key=<SAGESYNC_API_KEY>`.
- Response body: `{ active: boolean, expiresAt?: ISOString, ts: number, sig: hex }`.
- Verification:
  - HMAC over `JSON.stringify({active, expiresAt?, ts})` in that exact field order using `HMAC_SECRET`. Constant-time compare.
  - `ts` must be within `[now - 5min, now + 60s]`.
- Lives in a sibling repo on Vercel. Out of scope here, but rotations of `HMAC_SECRET` must coordinate with that repo.

---

## 6. Test architecture

| Layer | Path | Highlights |
|-------|------|------------|
| Unit | `tests/services/LicenseValidator.test.js` | 8 requirement specs (CFG-01/02, LIC-01..04, ENF-03/04). Mocks `axios.create` factory because `licenseClient` is created at module load. Uses `_reset()` between tests. |
| Unit | `tests/services/sageService.test.js` | MSSQL mocked at the `mssql` level. |
| Unit | `tests/services/fracttalClient.test.js` | Axios mocked. **Has one known-failing test** (`updateWarehouseItem`) — test expectation, not implementation, is wrong. See `.planning/phases/02-enforcement-surface/deferred-items.md`. |
| Unit | `tests/middleware/requireLicense.test.js` | Mocks LicenseValidator; exercises 503 + state field + `next()` happy path. |
| Integration | `tests/integration/licenseEnforcement.test.js` | Spins up a mini-Express that mirrors `main.js` structure. Mocks LicenseValidator and the heavy services so no real DB/API is hit. Covers ENF-01, STS-01. |
| Integration | `tests/integration/fracttal.integration.test.js` | API client integration. |
| Manual | `tests/manual/*.js` | Real-Fracttal-API smoke tests. `test-workflow.js` is the 10-step canonical flow against `TEST001` warehouse. **Require sandbox credentials in env.** |

Setup file `tests/setup.js` mocks the Winston logger globally and sets `jest.setTimeout(30000)`. Coverage report under `coverage/` after `npm run test:coverage`.

---

## 7. Deployment artifacts

### 7.1. Obfuscation pipeline

- `scripts/obfuscate.js` — copies the project into `dist/`, obfuscates every `.js` under `src/`, leaves `public/`, `package.json`, `config.json` etc. unmodified. Strips `devDependencies` and trims `scripts` to production-only.
- `.github/workflows/obfuscate-deploy.yml` — triggers on push to `src/**`, `public/**`, `package.json`, `package-lock.json`. Runs the script and force-pushes `dist/` to the dist repo on the same branch name.
- Target repo: `FReptar0/SageSync-dist`. Secret required: `OBFUSCATED_REPO_TOKEN` (PAT with `repo` scope).

### 7.2. Windows service via Servy

- `scripts/install-service.ps1` — idempotent install. Pre-flight checks Admin + Servy + Node + `src/main.js` presence; aborts gracefully if service already exists. Configures Servy with: `startupType=Automatic`, heartbeat 30s, max 3 failed checks → restart, max 5 restart attempts, size rotation 10MB × 5, stop timeout 30s.
- Optional params: `-InstallDir`, `-NodePath`, `-ServiceName`, `-Port`.
- Logs:
  - `logs/servy-stdout.log` + `logs/servy-stderr.log` (Servy-captured stdio)
  - `logs/sagesync.log` + `logs/error.log` (Winston)

### 7.3. Auto-mapping setup script

- `scripts/setup-automap.js` — first-time deployment helper. Connects to Sage300, lists active locations with stock, proposes a Fracttal warehouse code per location (`{prefix}-{cleanLocation}` by default `ALM-{code}`), authenticates against Fracttal, creates missing warehouses, writes `config.json`. Supports `--dry-run`.

---

## 8. Known edge cases & gotchas

These were either discovered the hard way or are deliberate. Read them before changing related code.

- **Item creation must use `/inventories/` not `/items/`.** Using `/items/` produces orphan assets without warehouse association — they exist in Fracttal but are invisible from inventory views. The current `createInventoryWithWarehouse()` does the right thing. Legacy methods are still in the client for back-compat but marked deprecated.
- **Setting stock on creation does nothing.** `POST /inventories/` always initializes stock to 0 regardless of what you send. You must follow it up with `PUT /inventories_adjustment/{code}` to set actual stock. The code already does this in Case C.
- **OAuth retry storm prevention.** The response interceptor in `FracttalClient` sets `originalRequest._retry = true` after a single 401-retry so it cannot loop. If 401 persists, the error propagates and the per-item try/catch in `app.js` increments `errors` for that item and moves on.
- **`UNAUTHORIZED_ENDPOINT` is a Fracttal-specific 401 variant.** It means the tenant does not have a module enabled. The client special-cases it (`error.isUnauthorizedEndpoint = true`) and surfaces a clear "contact Fracttal support" message instead of retrying the token.
- **DNS bypass detection is non-blocking.** It uses `dns.resolve4()` to skip the OS hosts file. If the license server resolves to a private/loopback IP, we log a warning but proceed — the HMAC + freshness checks are the primary gates.
- **License `ERROR` state has a 24h TTL.** If the license server has been unreachable longer than 24h since the last `VALID`/`INVALID` response, the cache is forced to `INVALID` and the app blocks. This is the deliberate offline grace window.
- **The cron tick re-validates the license, but `runSyncWithTracking` does not.** That is by design — the cron is the only periodic entry point, and validating there means a one-time license revocation propagates to the next tick at the latest. The manual `POST /api/sync` goes through `requireLicense` middleware so a revoked license already blocks it with 503.
- **`requireLicense` exemption for `/api/system/license` is in `main.js`, not in the middleware.** The middleware is single-responsibility and only knows how to return 503. The wrapper in `main.js` is the integration point. Don't move it without re-reading the integration test.
- **The frontend banner z-index is 1050 and overlay is 1049.** The banner stays visible above the dimming overlay so the message is always readable. The expiry badge only renders for `VALID` state within 30 days of `expiresAt`.
- **Pre-existing failing test.** `tests/services/fracttalClient.test.js > updateWarehouseItem` expects the deprecated `/items/{code}` path. It fails today because the implementation correctly calls `/inventories_adjustment/{code}`. **The test is wrong**; fix it to match the new path, not the other way around. See `.planning/phases/02-enforcement-surface/deferred-items.md`.
- **`config.json` is environment-shaped data, not secret.** It is committed because it serves as a sane default for the example mapping (`GRAL → ALM-AMP`). For real deployments, `setup-automap.js` overwrites it. Do not put credentials in there.
- **`logsRoutes.js` mounts at `/api/api/logs*` because it prefixes `/api/` inside the router and the router itself is mounted under `/api`.** This is a legacy oversight. `systemRoutes.js` exposes the proper `/api/logs*` path. Either way works; don't break the legacy path without checking the frontend.
- **There are two cron schedulers.** One in `main.js` (Express server) and one in `app.js` (standalone). Whichever process you run, exactly one cron runs. If you run both processes against the same `.env` you'll get double syncs.
