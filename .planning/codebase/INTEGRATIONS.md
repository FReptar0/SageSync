# External Integrations

**Analysis Date:** 2026-05-14

## APIs & External Services

**Fracttal CMMS REST API (primary write target):**
- Service: Fracttal one - inventory + warehouse + asset management API
- Base URL: `https://app.fracttal.com/api` (default; overridable via `FRACTTAL_BASE_URL`)
- Client: `src/services/fracttalClient.js` (`FracttalClient` class)
- HTTP library: axios 1.6.0 with a per-instance `axios.create({ baseURL, timeout: SYNC_TIMEOUT || 30000 })` and two interceptors:
  - Request interceptor injects `Authorization: Bearer <token>` via `getAccessToken()`
  - Response interceptor handles `UNAUTHORIZED_ENDPOINT` (no retry, flagged) and 401 token-expired (single retry after refresh)
- Auth: OAuth2 client_credentials (see "Authentication & Identity" below)
- Endpoints actively called from `src/services/fracttalClient.js`:
  - `GET /warehouses` — list all warehouses (`getWarehouses`, `getAllWarehouses`)
  - `GET /warehouses/{code}` — single warehouse (`getWarehouseByCode`)
  - `POST /warehouses/` — create warehouse (`createWarehouse`, called by `ensureWarehouseExists`)
  - `GET /warehouses/{warehouseId}/items` — paginated items (`getWarehouseItems`)
  - `GET /items` — list items (`getAllInventories`, also `searchWarehouseItem` with `code` param)
  - `GET /items/{code}` — single item (`getInventoryByCode`)
  - `POST /items/` — create asset (`createInventoryItem`)
  - `PUT /items/{code}` — update asset (`updateInventoryItem`)
  - `PUT /items/?id_fracttal={id}` — update by Fracttal numeric id (`updateInventoryItemById`)
  - `POST /inventories/` — **canonical** create item + associate to warehouse + initial stock (`createInventoryWithWarehouse`) — used in `src/app.js` Case C
  - `GET /inventories/{code}` — item with warehouse associations (`getItemInventory`)
  - `POST /inventories_associate_warehouse/` — associate existing item to warehouse (`associateItemToWarehouse`) — used in Case B
  - `PUT /inventories_adjustment/{code}` — **canonical** stock adjustment (`adjustInventoryStock`) — used in all three sync cases
  - `GET /warehouses_items/` — query items in warehouse (`getWarehouseStock`)
  - `POST /warehouse_entries_orders/{warehouse_code}` — warehouse entry (`createWarehouseEntry`)
  - `POST /warehouse_outputs_orders/` — warehouse exit (`createWarehouseExit`)
- Deprecated methods kept for backward compatibility (emit `logger.warn` with "DEPRECATED"): `createWarehouseItem`, `updateWarehouseItem`, `adjustInventory`, `updateInventoryAdjustment`.
- Token persistence: `.fracttal-token` at project root (gitignored). Managed by `src/config/configManager.js` (`saveToken`/`loadToken`/`clearToken`). Created/updated by `FracttalClient.authenticate()` and `refreshAccessToken()`. Stores `access_token`, `refresh_token`, `expires_in`, `token_type`, `created_at`, `expires_at`.

**sageconnect-license server (license validation):**
- Service: External license server (hosted at `sageconnect-license.vercel.app`, configured via `LICENSE_API_URL`)
- Client: `src/services/LicenseValidator.js` (dedicated `licenseClient = axios.create({ timeout: 10000 })`)
- Endpoint called: `GET {LICENSE_API_URL}/api/validate?key={SAGESYNC_API_KEY}`
- Returns: JSON `{ active: boolean, expiresAt?: string, ts: number, sig: string }`
- Auth: HMAC-SHA256 response signature verification (see "Authentication & Identity" below)
- Frequency:
  - **Startup gate**: called once at boot via `validate({ startup: true })` from `src/main.js`, `src/app.js`, `src/sync.js`. Three retries with exponential backoff (1s, 2s, 4s). If still not VALID, `process.exit(1)`.
  - **Periodic re-validation**: called inside the cron tick in `src/main.js` (line 62) and at the top of `syncInventory()` in `src/app.js` (line 22).
- Defense-in-depth: `dns.resolve4()` check warns (non-blocking) when hostname resolves to private/loopback IPs (RFC 1918 + 127.0.0.0/8) — hosts-file redirect detection.

## Data Storage

**Databases:**
- **Microsoft SQL Server (Sage300 — read-only):**
  - Driver: `mssql` 10.0.1
  - Connection config: `src/config/database.js` (singleton `Database` class with a connection pool: max 10, min 0, idleTimeoutMillis 30000, connectionTimeout/requestTimeout 60s)
  - Env vars: `DB_HOST`, `DB_PORT` (default 1433), `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_ENCRYPT`, `DB_TRUST_SERVER_CERTIFICATE`
  - Database schema accessed: `COPDAT.dbo.ICILOC` (item inventory by location) joined with `COPDAT.dbo.ICITEM` (item master), filtered by `I.INACTIVE = 0 AND I.STOCKITEM = 1`
  - Queries live in `src/services/sageService.js`:
    - `getAllInventoryItems()` — main sync query, hard-coded `B.LOCATION = 'GRAL'` filter (line 23)
    - `getInventoryItemsByLocation(location)` — parameterized location filter
    - `getInventoryItemByCode(itemNumber, location?)` — single item lookup
    - `getUniqueLocations()` — distinct `B.LOCATION`
    - `getInventoryStats()` — aggregate counts
    - `getConnectionInfo()` — server metadata (`DB_NAME()`, `@@SERVERNAME`, `@@VERSION`, `USER_NAME()`)
  - Computed stock formula: `ISNULL(B.QTYONHAND-B.QTYCOMMIT-B.QTYSHNOCST+B.QTYRENOCST+B.QTYADNOCST,0)` — net available quantity
  - Access pattern: **read-only**. No INSERT/UPDATE/DELETE statements anywhere in the codebase.

**File Storage:**
- Local filesystem only (no S3/Azure Blob/etc.)
- Files written by SageSync:
  - `.fracttal-token` (project root) — OAuth token cache. Gitignored.
  - `logs/sagesync.log` and `logs/error.log` — Winston-managed, 10MB x 5 rotation
  - `logs/servy-stdout.log` and `logs/servy-stderr.log` — Servy-captured stdio (production only)
  - `config.json` (project root) — Sage->Fracttal mapping, occasionally rewritten by `ConfigManager.saveConfig()` (e.g., from `scripts/setup-automap.js`)
  - `backups/` — Snapshots from `npm run maintenance:backup`

**Caching:**
- In-memory only:
  - **License cache**: `cachedState` object in `src/services/LicenseValidator.js` (singleton). Three states (VALID / INVALID / ERROR / UNKNOWN). ERROR state has a 24h TTL via `lastSuccessfulCheck`; after expiry, switches to INVALID.
  - **OAuth token cache**: `accessToken`, `refreshToken`, `tokenExpiry` instance fields on `FracttalClient`. Persisted across restarts via `.fracttal-token`.
  - **Sync state**: `src/services/syncStateManager.js` — `inProgress` flag, last-10 history, stats (totalSyncs/successfulSyncs/failedSyncs). Lost on restart.

## Authentication & Identity

**Fracttal OAuth2 (outgoing — write target):**
- Flow: OAuth2 client_credentials grant
- OAuth endpoint: `https://one.fracttal.com/oauth/token` (overridable via `FRACTTAL_OAUTH_URL`)
- Credentials: `FRACTTAL_CLIENT_ID` + `FRACTTAL_CLIENT_SECRET` env vars, sent as HTTP Basic auth (`Buffer.from(clientId:clientSecret).toString('base64')`)
- Body: `grant_type=client_credentials` (form-encoded, `application/x-www-form-urlencoded`)
- Token lifetime: server-provided `expires_in` (default fallback 7200s = 2h)
- Refresh flow: `grant_type=refresh_token&refresh_token={refreshToken}` — `FracttalClient.refreshAccessToken()`
- Re-auth trigger: `getAccessToken()` re-authenticates when fewer than 5 minutes remain
- Reactive refresh: response interceptor in `FracttalClient` constructor (line 36-100) retries once on HTTP 401 (excluding `UNAUTHORIZED_ENDPOINT` business errors)
- Persistence: `.fracttal-token` JSON file (see "Data Storage")

**SageSync license HMAC (incoming validation):**
- Algorithm: HMAC-SHA256 (`crypto.createHmac('sha256', hmacSecret)`)
- Shared secret: `HMAC_SECRET` env var (must exactly match the license server's secret)
- Payload construction (deliberately ordered to survive obfuscation): `{ active }` first, then `{ expiresAt }` only when `active === true`, then `{ ts }`. Signature is `hex(hmac(JSON.stringify(payload)))`.
- Verification: `verifySignature()` in `src/services/LicenseValidator.js` (line 70) uses `crypto.timingSafeEqual` for constant-time comparison.
- Timestamp freshness window: 5 minutes past (`FRESHNESS_WINDOW_MS = 5 * 60 * 1000`), 60 seconds future tolerance for clock skew (`FUTURE_TOLERANCE_MS = 60 * 1000`).
- Failure modes: invalid HMAC -> state `ERROR` with reason "HMAC signature mismatch"; stale timestamp -> state `ERROR` with reason "Stale timestamp"; both rely on the 24h ERROR TTL before switching to INVALID.

**Sage300 SQL Server (incoming — read source):**
- Mechanism: SQL Server native auth (username/password) via `DB_USER` + `DB_PASSWORD`
- TLS controlled by `DB_ENCRYPT` and `DB_TRUST_SERVER_CERTIFICATE` (both env-controlled, both passed through to `mssql.connect`)

**Internal API gate (Express middleware):**
- `src/middleware/requireLicense.js` — synchronous gate using `LicenseValidator.isValid()`. Returns HTTP 503 with `{ error, state }` when license is not VALID. Mounted in `src/main.js` BEFORE `express.static`.
- Exemption: `/api/system/license` (always accessible — handled by wrapper in `src/main.js`, not inside the middleware itself).

## Monitoring & Observability

**Error Tracking:**
- No external service (Sentry/Bugsnag/etc.). All error handling is local through Winston.
- Errors flow into `logs/error.log` (Winston `level: 'error'` transport) and `logs/sagesync.log` (all levels). Format: JSON with `timestamp`, `service: 'sagesync'`, stack traces enabled.

**Logs:**
- Winston singleton: `src/config/logger.js` — `require('../config/logger')` everywhere.
- File transports rotate at 10MB x 5 (default; overridable via `LOG_MAX_SIZE`/`LOG_MAX_FILES`).
- Console transport active only when `NODE_ENV !== 'production'` (colorized + simple format).
- Log files: `logs/sagesync.log`, `logs/error.log`.
- Servy adds a second layer in production: `logs/servy-stdout.log` and `logs/servy-stderr.log`.
- Built-in viewer: `src/controllers/logsController.js` + `src/utils/logParser.js`, exposed under `/api/logs` (`/logs`, `/logs/stats`, `/logs/dates`, `/logs/test`).

**Health/Status endpoints:**
- `GET /api/system/status` (`src/controllers/systemController.js` `getSystemStatus`) — Sage connectivity, Fracttal token state, Fracttal module availability check (calls `getAllWarehouses` + `getAllInventories` to detect `UNAUTHORIZED_ENDPOINT`), sync state and stats, uptime.
- `GET /api/system/license` (`src/routes/systemRoutes.js`) — license state, last-checked timestamp, expiry, HMAC-configured flag. **Always accessible** even when license is invalid (exempt from `requireLicense` gate).
- `GET /api/test/connections` (`src/controllers/systemController.js` `testConnections`) — explicit Sage + Fracttal probe.

## CI/CD & Deployment

**Hosting:**
- On-premise Windows Server per client (single-tenant per deployment).
- License server is hosted at `sageconnect-license.vercel.app` (Vercel) — separate engagement, see `CLAUDE.md` "Out of scope".

**CI Pipeline:**
- GitHub Actions: `.github/workflows/obfuscate-deploy.yml`
- Trigger: `push` events with paths matching `src/**`, `public/**`, `package.json`, `package-lock.json`, plus `workflow_dispatch` (manual)
- Runner: `ubuntu-latest`, Node 18, `npm ci`
- Steps:
  1. Checkout source (`actions/checkout@v4`, `fetch-depth: 0`)
  2. Setup Node (`actions/setup-node@v4`, `cache: npm`)
  3. `npm ci`
  4. `node scripts/obfuscate.js` (writes obfuscated artifact to `dist/`)
  5. Initialize git in `dist/`, commit, force-push to `FReptar0/SageSync-dist` using `OBFUSCATED_REPO_TOKEN` PAT secret on the same branch as the source.
- Permissions: `contents: read`

**Production deployment (manual):**
- PowerShell installer: `scripts/install-service.ps1`
- Wraps Servy CLI to register the Windows Service `SageSync` (auto-start, health monitor every 30s, restart-on-failure up to 5 times, Servy-native log rotation 10MB x 5).
- Pre-flight checks: admin elevation, `servy-cli` on PATH, `node.exe` at `C:\Program Files\nodejs\node.exe`, install dir contains `src\main.js`, service not already installed.
- Default install dir: `E:\SageSync`. Default port: 3000.

## Environment Configuration

**Required env vars (enforced at boot by `src/utils/validateEnv.js`):**
- **License group:** `LICENSE_API_URL`, `HMAC_SECRET`, `SAGESYNC_API_KEY`
- **Database group:** `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
- **Fracttal group:** `FRACTTAL_CLIENT_ID`, `FRACTTAL_CLIENT_SECRET`

**Optional env vars (with defaults observed in `src/config/*.js`):**
- `DB_PORT` (1433), `DB_ENCRYPT`, `DB_TRUST_SERVER_CERTIFICATE`
- `FRACTTAL_BASE_URL` (`https://app.fracttal.com/api`), `FRACTTAL_OAUTH_URL` (`https://one.fracttal.com/oauth/token`), `SYNC_TIMEOUT` (30000ms)
- `PORT` (3000), `SYNC_CRON_SCHEDULE` (`0 2 * * *`), `SYNC_ON_STARTUP`
- `LOG_LEVEL` (info), `LOG_FILE`, `LOG_MAX_SIZE` (10m), `LOG_MAX_FILES` (5), `LOG_DIRECTORY`, `LOG_MAX_LINES` (10000), `LOG_UPDATE_INTERVAL` (60000)
- `DEFAULT_PAGINATION_LIMIT` (50), `MAX_PAGINATION_LIMIT` (500)
- `NODE_ENV`

**Secrets location:**
- `.env` at project root — gitignored (`.gitignore` line 76, plus environment-specific variants `.env.production`, `.env.staging`, `.env.development` on lines 172-174).
- `.fracttal-token` at project root — gitignored (`.gitignore` line 140) — auto-managed; delete to force re-auth.
- `.sage-credentials` — reserved/legacy name, gitignored (`.gitignore` line 141), not actively read by current code.
- `config/database-credentials.json`, `config/api-keys.json` — gitignored placeholders (`.gitignore` lines 144-145), not present in repo.
- GitHub Actions secret: `OBFUSCATED_REPO_TOKEN` (PAT with repo write to `SageSync-dist`) — required for the deploy job.

## Webhooks & Callbacks

**Incoming:**
- None. SageSync exposes a REST API for the dashboard (`/api/system/*`, `/api/sync/*`, `/api/sage/*`, `/api/fracttal/*`, `/api/logs/*`) but does not accept webhooks from Fracttal or the license server.
- The license server is polled (pull model); the license server never calls back into SageSync.

**Outgoing:**
- None. SageSync pushes inventory changes to Fracttal via direct REST calls and pulls validation from the license server; it does not publish webhooks or callbacks elsewhere.

---

*Integration audit: 2026-05-14*
