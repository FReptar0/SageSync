# Codebase Concerns

**Analysis Date:** 2026-05-14

This document enumerates technical debt, fragile areas, known limitations, security exposures, and performance concerns for SageSync — a one-way Sage300 → Fracttal inventory sync service. Concerns are severity-rated **Critical / High / Medium / Low**. The "Don't touch" sections at the end map to load-bearing code paths that are intentionally locked down (per `CLAUDE.md`).

---

## Tech Debt

### TD-1 — Deprecated Fracttal client methods still resident in `fracttalClient.js`
- **Severity:** Medium
- **Issue:** Three legacy methods remain in `src/services/fracttalClient.js` only to emit a `logger.warn('DEPRECATED:...')` and forward to the new method. They still occupy public surface area:
  - `createWarehouseItem(warehouseId, itemData)` at `src/services/fracttalClient.js:260`-`263`
  - `updateWarehouseItem(warehouseId, itemId, itemData)` at `src/services/fracttalClient.js:265`-`269`
  - `adjustInventory(warehouseId, itemId, quantity, reason)` at `src/services/fracttalClient.js:287`-`295`
  - `updateInventoryAdjustment(itemCode, adjustmentData)` at `src/services/fracttalClient.js:552`-`555` ("alias para compatibilidad con código existente")
- **Files:** `src/services/fracttalClient.js`
- **Impact:**
  - New contributors may use deprecated methods unknowingly — and `adjustInventory` ships with `unit_cost_stock: 0` hardcoded (`src/services/fracttalClient.js:292`), which would silently zero-out costs in Fracttal if called.
  - The deprecated `adjustInventory` comment says "debería venir de los datos reales" — an admission of incomplete migration.
  - `tests/services/fracttalClient.test.js:238`-`256` still asserts on the deprecated `updateWarehouseItem` behavior (expecting `/items/item1` but the deprecated method now forwards to `/inventories_adjustment/item1`, so the test is broken). See KB-1.
- **Fix approach:** Remove the four deprecated methods, grep tests for references, update `tests/services/fracttalClient.test.js`, and bump a major version. Confirmed safe per `docs/MEMORY.md` section 2.3: "Los métodos viejos siguen en `fracttalClient.js` ... marcados como DEPRECATED. No los uses para código nuevo; eventualmente se podrán quitar pero requiere validar que ningún test los referencia."

### TD-2 — Language mixing within the codebase (es/en)
- **Severity:** Low
- **Issue:** Files are split between Spanish (older v1.0: `app.js`, `sageService.js`, `fracttalClient.js`, `maintenance.js`, `configManager.js`) and English (v1.1 license layer: `LicenseValidator.js`, `requireLicense.js`, `validateEnv.js`, `license.js`). User-facing logs are uniformly Spanish.
- **Files:** project-wide; documented in `docs/MEMORY.md` section 3.1 and `CLAUDE.md` "Conventions" section.
- **Impact:** Cognitive overhead for contributors. Convention is documented ("keep the file's language when you edit it"), but the rule depends on every contributor reading `CLAUDE.md`.
- **Fix approach:** Accept as historical artifact. Do NOT translate retroactively — risk of breaking log parsers that grep for Spanish strings (e.g., `src/utils/logParser.js` 254 lines). Document the convention and move on.

### TD-3 — Dual entry points (`main.js` and `app.js`) duplicate license gate + cron wiring
- **Severity:** Medium
- **Issue:** `src/main.js:28` and `src/app.js:189` both call `validateLicense({ startup: true })`. `src/main.js:59` and `src/app.js:191` both register `cron.schedule(...)`. Each entry point can spawn its own scheduler.
- **Files:** `src/main.js`, `src/app.js`, `src/sync.js`
- **Impact:**
  - Running `npm start` (main.js) and `npm run sync-only` (app.js) in parallel would produce **two cron schedulers** firing the same sync — Fracttal would receive duplicate writes.
  - Three places need updating when license/env wiring changes (`main.js`, `app.js`, `sync.js`).
- **Fix approach:** Per `docs/MEMORY.md` section 1.4, the duplication is **deliberate** (some deployments want headless mode). Recommended path: factor a shared `bootstrap()` in `src/utils/bootstrap.js` that both entry points call; ensure only one cron consumer registers per process. Until then, document operational invariant: **never run main.js and app.js in the same Node process**.

### TD-4 — `console.log`/`console.error` mixed with Winston in service layer
- **Severity:** Low
- **Issue:** 98 `console.log`/`console.error` calls in `src/`. They co-exist with Winston logger calls in `fracttalClient.js`, `configManager.js`, and `maintenance.js`. Convention (per `CLAUDE.md`) is "never `console.log` for production paths".
- **Files:** Heaviest in `src/services/fracttalClient.js` (~30 console calls with emojis), `src/maintenance.js`, `src/controllers/systemController.js:26`.
- **Impact:** When running under Servy in production, `console.*` is captured separately (`logs/servy-stdout.log`/`logs/servy-stderr.log`) from Winston logs (`logs/sagesync.log`). Operators have to grep two places.
- **Fix approach:** Replace `console.*` with `logger.info/warn/error` incrementally. Keep emoji-decorated console output only where it's intentionally for the on-server operator's PowerShell window (e.g., manual sync runs); always also emit a logger line.

### TD-5 — Placeholder defaults in transformation methods
- **Severity:** Medium
- **Issue:** Several "valor por defecto, ajustar según necesidades" comments mark unfinished mappings:
  - `src/services/sageService.js:141`: `unit_of_measure: 'UN', // Valor por defecto, ajustar según necesidades`
  - `src/services/sageService.js:142`: `category: 'Inventory', // Valor por defecto`
  - `src/services/sageService.js:118`: in `getLastSyncInfo()`: "Podrías crear una tabla para trackear esto" — sync tracking is faked with `SELECT GETDATE() AS CurrentTime`.
  - `src/services/fracttalClient.js:292`: deprecated `adjustInventory` zeroes `unit_cost_stock` — see TD-1.
- **Files:** `src/services/sageService.js`, `src/services/fracttalClient.js`
- **Impact:** Items shipped to Fracttal default to unit code `UN` regardless of Sage's actual UOM; min/max stock derived as `MinimumStock * 3` (also defaulted to 100 if MinimumStock is 0 — `src/app.js:96`, `src/services/fracttalClient.js:614`, `src/services/sageService.js:155`).
- **Fix approach:** Surface unit-of-measure from `ICITEM` (Sage300 has `STOCKUNIT`); make `max_stock_level` configurable per warehouse in `config.json`; persist real sync timestamps in a SageSync-owned SQLite or in `syncStateManager` history (currently in-memory only, see KB-3).

### TD-6 — Hardcoded location filter in main Sage query
- **Severity:** Medium
- **Issue:** `src/services/sageService.js:23` hardcodes `AND B.LOCATION = 'GRAL'` in the main `inventoryQuery` template. This filter is **always applied** by `getAllInventoryItems()`. The location mapping work in `mapSageLocationToFracttalWarehouse()` (`sageService.js:167`) is dead code for the default flow because only `GRAL` rows ever come back.
- **Files:** `src/services/sageService.js:8`-`25`
- **Impact:** Customers with multi-location Sage setups silently get only `GRAL` synced. The `config.json` `locationMapping` block — and the special-rule keyword logic — is moot for the default sync.
- **Fix approach:** Make the location filter driven by `config.json` (`syncSettings.locations: ["GRAL", "BODEGA1", ...]`) or accept all `B.LOCATION` values that exist in the mapping. Either way, remove the hardcoded `'GRAL'`. Add a regression test that runs against a fixture with multiple locations.

### TD-7 — `transformToFracttalFormat` is unused dead code
- **Severity:** Low
- **Issue:** `src/services/sageService.js:132`-`146` defines `transformToFracttalFormat()` returning a flat object with fields (`name`, `description`, `category`, `sync_source`, `sync_date`) that no caller uses — the sync loop in `src/app.js` constructs `createData` inline.
- **Files:** `src/services/sageService.js`
- **Impact:** Misleading reference. New contributors may modify it expecting it to take effect.
- **Fix approach:** Delete or convert into the canonical transformation called by `app.js`. Verify with `grep -rn transformToFracttalFormat .` first.

### TD-8 — `Database.isConnected()` has a typo bug
- **Severity:** Low
- **Issue:** `src/config/database.js:94`: `return this.connected && this.pool && !this.pool.connected === false;`
  - `!this.pool.connected === false` parses as `(!this.pool.connected) === false` — i.e., it returns `true` only when `pool.connected` is truthy. The double negation is unintentional; the apparent intent was `this.pool.connected !== false` or simply `this.pool.connected`.
  - However, **no caller invokes `isConnected()`**, so the bug doesn't trigger today.
- **Files:** `src/config/database.js:93`-`95`
- **Impact:** Latent bug. If a future contributor writes `if (db.isConnected())` they'll get a confusing logic puzzle.
- **Fix approach:** Either delete the method or rewrite as `return this.connected && !!this.pool;`.

### TD-9 — `node-windows` installed but unused; production uses Servy
- **Severity:** Low
- **Issue:** `package.json` lists `node-windows` as a dependency, but `docs/DEPLOYMENT.md` and `scripts/install-service.ps1` document Servy as the production service manager. The codebase has no `service-installer.js` despite `scripts.install-service` referencing `src/service-installer.js` in `scripts/obfuscate.js:252`-`253`.
- **Files:** `package.json`, `scripts/obfuscate.js:252`-`253`
- **Impact:** Dead dependency in supply chain; obfuscator generates a `package.json` in `dist/` with a broken `install-service` script pointing at a non-existent file.
- **Fix approach:** Remove `node-windows` from dependencies. Either delete the obfuscator's `install-service` / `uninstall-service` script lines, or add a real `src/service-installer.js` if node-windows installation is still supported.

---

## Fragile Areas

### FA-1 — License gate ordering in `main.js` is load-bearing
- **Severity:** High
- **Issue:** `src/main.js:22`-`44` requires a specific call order: `validateEnv()` (line 22) → `validateLicense({startup: true})` (line 28) → `express.json` (line 33) → `requireLicense` wrapper (lines 38-42) → `express.static` (line 44) → routes (line 84) → `errorHandler` (line 87). `CLAUDE.md` calls out "Don't reorder."
- **Files:** `src/main.js`
- **Impact:** Reordering can:
  - Expose static HTML before the license gate triggers (if `express.static` moves before `requireLicense`).
  - Break `/api/system/license` exemption (if the wrapper at lines 39-42 moves after `apiRoutes`).
  - Cause crash-on-boot if `validateLicense` runs before `validateEnv` and env vars are missing (validateLicense then throws on `undefined` HMAC_SECRET).
- **Fix approach:** Add an integration test that hits `/`, `/api/system/license`, and `/api/sync` under both VALID and INVALID license states and asserts response codes. The test will fail if anyone reorders. Test scaffolding example in `tests/integration/licenseEnforcement.test.js`.

### FA-2 — Two-step Case C is non-optional
- **Severity:** High
- **Issue:** `src/app.js:122`-`138` (Case C: new item) does:
  1. `await fracttal.createInventoryWithWarehouse(createData)` — creates item, associates to warehouse, **forces stock=0** server-side regardless of the `stock` field sent.
  2. `await fracttal.adjustInventoryStock(itemCode, adjustmentData)` — sets real stock via `PUT /inventories_adjustment/{code}`.
- **Files:** `src/app.js:119`-`139`; documented in `docs/MEMORY.md` section 2.2.
- **Impact:** If step 2 fails after step 1 succeeds, Fracttal has the item with **stock=0** (it's not an "orphan" anymore — it's associated to the warehouse — but the stock figure is wrong until the next sync tick). There is no atomic rollback.
- **Fix approach:** Wrap the two calls in an outer try/catch that, on step 2 failure, logs a `CRITICAL` warning identifying the item code and pushes it to a retry queue (which doesn't exist today). At minimum, increment `errors++` and continue. Document the gap clearly. Do NOT attempt to merge the two API calls — `POST /inventories/` ignores the `stock` field by Fracttal's design (per MEMORY 2.2).

### FA-3 — Per-item error swallowing in sync loop hides systemic failures
- **Severity:** Medium
- **Issue:** `src/app.js:148`-`154`: each item is in its own try/catch that increments `errors++` and `continue`s. The outer summary only logs a count (`errors: N`).
- **Files:** `src/app.js`
- **Impact:** If 100% of items fail due to e.g., a Fracttal credential rotation, the loop runs to completion, logs `errors: 5000`, and reports "completado exitosamente" at line 178. There's no early-exit or threshold-based abort.
- **Fix approach:** Add a circuit-breaker: if `errors > 5` consecutively (or `errors / processed > 0.5`), break out and throw to the outer catch. Differentiate "transient per-item bug" from "the destination API is fundamentally broken right now".

### FA-4 — Obfuscation pipeline is fragile and impacts production distribution
- **Severity:** High
- **Issue:** Two coupled pieces:
  - `scripts/obfuscate.js` — 316 lines, uses `javascript-obfuscator` with high-aggression options including `controlFlowFlattening`, `deadCodeInjection`, `stringArrayEncoding: ['base64']`. Any option change can break runtime behavior in subtle ways (e.g., breaking dynamic `require()`).
  - `.github/workflows/obfuscate-deploy.yml` — auto-runs on every push to `src/**`, `public/**`, `package.json`, force-pushes to `SageSync-dist` repo using `OBFUSCATED_REPO_TOKEN` secret.
- **Files:** `scripts/obfuscate.js`, `.github/workflows/obfuscate-deploy.yml`
- **Impact:**
  - `scripts/obfuscate.js:294`: `git push -u origin HEAD:${currentBranch} --force` — force-pushes from the local `main` to `SageSync-dist:main`. A bad commit makes it to clients quickly.
  - Obfuscator options are tuned for "selfDefending: false" and "debugProtection: false" (per `docs/MEMORY.md` section 1.5) for production troubleshooting; turning these on would break Servy installs in unpredictable ways.
  - If `OBFUSCATED_REPO_TOKEN` rotates without updating the GitHub secret, the workflow fails silently for the operator who isn't watching CI.
- **Fix approach:**
  - Add a CI guard: run a smoke test on `dist/` (`node dist/src/main.js --version` or similar) before pushing.
  - Document `OBFUSCATED_REPO_TOKEN` rotation procedure in `RUNBOOK.md`.
  - Drop `--force` and use a release branch with PR review for production releases (currently a hard force-push to main of `SageSync-dist`).

### FA-5 — `requireLicense` exemption logic lives outside the middleware
- **Severity:** Medium
- **Issue:** `src/main.js:38`-`42` wraps `requireLicense` to exempt `/api/system/license`. `src/middleware/requireLicense.js` is a clean single-responsibility gate. `CLAUDE.md` explicitly calls out this split as intentional ("Don't touch without thinking twice").
- **Files:** `src/main.js:38`-`42`, `src/middleware/requireLicense.js`
- **Impact:** Future contributors may "consolidate" by moving the exemption into the middleware, creating coupling. Alternatively, adding new exempt paths requires touching `main.js` rather than just the middleware — easy to miss in a feature branch.
- **Fix approach:** Keep as-is. Add a comment block at `src/middleware/requireLicense.js:9`-`13` already documents this. Reinforce via the integration test (see FA-1) that hits `/api/system/license` under INVALID and asserts a `200` response.

### FA-6 — In-band license re-validation pauses sync
- **Severity:** Medium
- **Issue:** `src/main.js:62`-`66`: cron tick awaits `validateLicense()` before checking `isInProgress`. If the license server is slow (close to the 10s `HTTP_TIMEOUT_MS` in `LicenseValidator.js:31`), the sync start is delayed by up to 10 seconds per tick. If the server is down, the tick waits the full timeout before checking the 3-state cache and proceeding.
- **Files:** `src/main.js:62`, `src/app.js:22`, `src/services/LicenseValidator.js:31`
- **Impact:** Network-dependent cron tick. On a default schedule (`0 2 * * *`, daily 2am), this is benign. On a 5-minute schedule, multiple ticks could pile up.
- **Fix approach:** Move `validateLicense()` to an independent timer (e.g., every 15 minutes) and let the cron tick use `isValid()` synchronously. The 3-state cache + 24h TTL already supports this. Per `docs/MEMORY.md` section 1.7, the current design ("cron re-validates, sync manual does not") is deliberate, so coordinate with the license-guard agent before changing.

### FA-7 — `SyncStateManager` is in-memory only
- **Severity:** Medium
- **Issue:** `src/services/syncStateManager.js:4`-`16`: state, stats, last result, and history (10 entries) live in `this.state` on a class instance. On Node restart all history is lost.
- **Files:** `src/services/syncStateManager.js`
- **Impact:**
  - Dashboard at `/` shows empty stats after every restart.
  - No persistent audit trail. After a Servy restart, you can't tell "did the last cron tick run?" from anything but `logs/sagesync.log`.
  - Two-process coordination is broken: `main.js` and `app.js` each have their own `SyncStateManager`, so `isInProgress()` returns false in process B even when process A is mid-sync.
- **Fix approach:** Persist state to `state/sync-state.json` or to a tiny SQLite. At least flush after each sync end. Add a startup load step.

### FA-8 — `validateEnv()` runs at module import time
- **Severity:** Medium
- **Issue:** `src/app.js:13` calls `validateEnv()` at top-level (not inside a function). Any module that requires `src/app.js` triggers `validateEnv()` immediately, which calls `process.exit(1)` if env vars are missing.
- **Files:** `src/app.js:13`, `src/main.js:22`, `src/sync.js:14`, `src/utils/validateEnv.js:31`
- **Impact:** Documented historical incident in `docs/MEMORY.md` section 4.2 — Jest workers crashed because `require('../app')` triggered `process.exit(1)`. Workaround in tests is `jest.mock('../../src/app', () => ({ syncInventory: jest.fn() }))` before imports. Any new test or REPL session touching `app.js` has to know this trap.
- **Fix approach:** Move the top-level `validateEnv()` and `validateLicense()` calls inside the `start()` function (lines 187-200) so importing `syncInventory` doesn't kill the process. Coordinate with `tests/integration/licenseEnforcement.test.js` which depends on the current mock setup.

### FA-9 — Force-push to `SageSync-dist` `main` rewrites history every CI run
- **Severity:** High
- **Issue:** `scripts/obfuscate.js:294` and `.github/workflows/obfuscate-deploy.yml:63` both use `git push --force origin HEAD:...`. The dist repo's history is rewritten on every source push.
- **Files:** `scripts/obfuscate.js:294`, `.github/workflows/obfuscate-deploy.yml:63`
- **Impact:**
  - Clients who clone `SageSync-dist` can't `git pull` reliably — they need `git fetch && git reset --hard`.
  - No way to rollback to "the previous dist" via git log.
  - If someone accidentally pushes a bad commit to `main` of the source repo, CI immediately propagates it to all clients on next `git pull`.
- **Fix approach:** Push to a tagged release branch (e.g., `dist/v1.1.3`) instead of force-pushing `main`. Cut releases manually with `gh workflow run`.

---

## Security Considerations

### SEC-1 — HMAC secret handled in `LicenseValidator.js`
- **Severity:** High
- **Issue:** `src/services/LicenseValidator.js:128`-`130` logs the first 8 characters of `HMAC_SECRET` on every `validate()` call:
  ```js
  logger.info('[LICENSE] HMAC secret loaded (prefix: ' + licenseConfig.hmacSecret.slice(0, 8) + '...)');
  ```
  - The prefix is logged on every cron tick — accumulates in `logs/sagesync.log` indefinitely (rotated at 10MB × 5).
  - 8 chars from a hex/base64 secret reduces brute-force search space — defense-in-depth violation.
- **Files:** `src/services/LicenseValidator.js:128`-`130`
- **Impact:** If logs are shared with support, copied to a ticket, or backed up to an off-host location, an 8-char prefix leaks. Combined with another data source (e.g., a partial copy of `.env`), this could accelerate an HMAC compromise.
- **Current mitigation:** Logs are local to the server. `.env` and `.fracttal-token` are in `.gitignore`.
- **Recommendations:**
  - Log only `[LICENSE] HMAC secret loaded (length=N)` instead of a prefix.
  - Better: log the prefix only at `debug` level so production (`info`) doesn't capture it.
  - If you need to confirm the secret matches between client and server, hash both sides separately and log the hash, not the secret.

### SEC-2 — DNS bypass detection in LicenseValidator is non-blocking
- **Severity:** Medium
- **Issue:** `src/services/LicenseValidator.js:163`-`201`: `_checkDns()` uses `dns.resolve4()` (which bypasses the OS hosts file) to verify the license server hostname doesn't resolve to a private/loopback address. On mismatch, it **only warns** — does not block.
  - Comment at line 180: "Warns on private/loopback IPs but does NOT block -- HMAC is the primary gate."
- **Files:** `src/services/LicenseValidator.js:181`-`201`
- **Impact:** A malicious operator could edit `C:\Windows\System32\drivers\etc\hosts` to point `sageconnect-license.vercel.app` at a fake local server. The HMAC check is the actual gate — the attacker would also need `HMAC_SECRET` to forge a `sig`. So the bypass alone doesn't break enforcement, but it does pair well with an `HMAC_SECRET` leak (see SEC-1).
- **Current mitigation:** HMAC + freshness + 24h ERROR TTL. The DNS check exists as defense-in-depth.
- **Recommendations:** Keep non-blocking, but ensure the warning is **always** loggable above `info` level so operators can grep for it. Consider promoting to `error` level after N consecutive warnings.

### SEC-3 — `.env`, `.fracttal-token`, and credential files require disciplined handling
- **Severity:** High
- **Issue:** SageSync depends on three secret-bearing files on disk:
  - `.env` — HMAC_SECRET, SAGESYNC_API_KEY, DB_PASSWORD, FRACTTAL_CLIENT_ID/SECRET (loaded by `src/utils/validateEnv.js`).
  - `.fracttal-token` — OAuth access + refresh tokens, plain JSON at repo root (managed by `src/config/configManager.js:50`-`93`).
  - `.sage-credentials` — referenced in `.gitignore` and `scripts/obfuscate.js:60`; existence unclear in current tree.
- **Files:** `.env` (gitignored), `.fracttal-token` (gitignored), `src/config/configManager.js:50`-`68` (saveToken — writes JSON to filesystem).
- **Impact:**
  - `saveToken()` at `src/config/configManager.js:61` writes refresh tokens to a JSON file with default file permissions. On Windows, this means whatever ACL the install user has — typically read by Administrators group.
  - No encryption at rest.
  - If the operator forgets to apply `icacls` to restrict ACL on `.fracttal-token`, any local user can read it.
- **Current mitigation:** `.gitignore` covers both. `scripts/obfuscate.js:56`-`60` excludes them from `dist/`. CLAUDE.md `.claude/settings.json` deny rules cover `.env`/`.fracttal-token`/`*.pem`.
- **Recommendations:**
  - Add a deployment step in `docs/DEPLOYMENT.md`: `icacls .fracttal-token /inheritance:r /grant:r "{ServiceUser}:R"`.
  - Consider DPAPI (Windows) or platform-keyring for the refresh token.
  - Periodic audit: ensure `.fracttal-token` has not been committed accidentally — `git log --all -- .fracttal-token` should be empty.

### SEC-4 — SQL string interpolation in `sageService.getInventoryItemsByLocation`
- **Severity:** Low
- **Issue:** `src/services/sageService.js:43`: `const query = this.inventoryQuery + ' AND B.LOCATION = @location';` uses parameterized binding via `mssql`'s `request.input(key, parameters[key])` (`src/config/database.js:71`-`73`). This is **correct** — not a SQL injection risk.
- **Files:** `src/services/sageService.js:43`, `src/services/sageService.js:55`-`56`, `src/config/database.js:62`-`81`
- **Impact:** None — parameterization is in place. Mentioned here so reviewers don't pattern-match the visual concatenation and miss the safe binding underneath.
- **Recommendations:** N/A. Document the safety in a comment for future reviewers.

### SEC-5 — `errorHandler` logs request body in error responses
- **Severity:** Medium
- **Issue:** `src/middleware/errorHandler.js:5`-`13` logs `req.body` with the error message and stack. If a future route accepts a payload containing tokens, passwords, or PII, those would land in `logs/error.log`.
- **Files:** `src/middleware/errorHandler.js`
- **Impact:** Currently low (no auth-aware routes in `src/routes/`), but the pattern doesn't scale — when license-renew or credential-update endpoints get added, the body will leak.
- **Recommendations:** Strip known-sensitive keys (`password`, `token`, `secret`, `apikey`) before logging. Add a `sanitize()` helper.

### SEC-6 — Obfuscation as IP protection, not security control
- **Severity:** Low (documentation gap)
- **Issue:** Per `docs/MEMORY.md` section 1.5, obfuscation is "defense-in-depth" IP protection, not a security boundary. Any client running `dist/` can deobfuscate with effort.
- **Files:** `scripts/obfuscate.js`, `.github/workflows/obfuscate-deploy.yml`
- **Impact:** Risk of false-sense-of-security. A future maintainer might lean on obfuscation to hide a "real" secret (don't).
- **Recommendations:** Document in `SECURITY.md` that obfuscation is an IP-protection layer, not a cryptographic one. All secrets stay in `.env` on the client server.

---

## Performance Bottlenecks

### PERF-1 — Sequential per-item processing in sync loop
- **Severity:** High
- **Issue:** `src/app.js:53`-`155`: items processed serially in a `for (const sageItem of sageItems)` loop. Each item triggers up to **three** Fracttal API calls (Case B/C: `ensureWarehouseExists` → `checkItemExistsInWarehouse` → `associateItemToWarehouse`/`createInventoryWithWarehouse` → `adjustInventoryStock`). With 30s default timeout (`SYNC_TIMEOUT`), each item is bounded by network latency × N calls.
- **Files:** `src/app.js:53`-`155`
- **Impact:** For a 5,000-item Sage inventory:
  - Average ~3 HTTP calls per item × ~500ms each = ~1.5s/item.
  - 5,000 items × 1.5s = 2h 5min per sync.
  - With cron at `0 2 * * *` (daily 2am), this fits the night window — barely. But the moment a customer has 20k items, the sync runs into business hours.
- **Fix approach:** Batch items per-warehouse and use `Promise.all` with concurrency limit (e.g., `p-limit` set to 5). Fracttal's rate limit is undocumented in code — start conservatively. Alternative: precompute warehouse existence once at sync start, cache `checkItemExistsInWarehouse` results per item across calls.

### PERF-2 — `ensureWarehouseExists` called per item
- **Severity:** High
- **Issue:** `src/app.js:77`-`85`: every item triggers `await fracttal.ensureWarehouseExists(fracttalWarehouse)`. If 5,000 items share warehouse `GRAL_MAIN`, that's 5,000 `GET /warehouses/GRAL_MAIN` calls (each protected by axios's `getAccessToken()` token check).
  - The `if (!warehousesCreated.includes(fracttalWarehouse))` check just records that warehouses were touched — it doesn't skip the API call.
- **Files:** `src/app.js:77`-`85`, `src/services/fracttalClient.js:685`-`741`
- **Impact:** Massive duplicate work. For a typical sync, 90% of API calls to `/warehouses/{code}` are redundant.
- **Fix approach:** Precompute the unique set of warehouses from the location mapping; call `ensureWarehouseExists` once per unique warehouse at the start; pass a `Set<string>` of guaranteed-existing warehouse codes into the loop.

### PERF-3 — MSSQL connection pool may reconnect every query
- **Severity:** Medium
- **Issue:** `src/config/database.js:62`-`80`: `query()` checks `if (!this.connected || !this.pool)` and calls `this.connect()`, which **closes the existing pool** (`src/config/database.js:33`-`35`) before reconnecting. The pool has `max: 10` connections (line 17), but the singleton pattern doesn't reuse them across the sync loop.
- **Files:** `src/config/database.js:31`-`46`, `src/config/database.js:62`-`81`
- **Impact:**
  - The full sync flow does one query (`getAllInventoryItems`), so the bug doesn't bite hard today.
  - If/when SageSync gets additional Sage queries (e.g., per-item lookups), each one risks tearing down the pool.
- **Fix approach:** Remove the `if (this.pool) await this.pool.close();` at line 33. Only connect if `this.pool` is null. Add tests for "concurrent queries reuse the same pool".

### PERF-4 — `getAccessToken()` runs on every Fracttal request
- **Severity:** Low
- **Issue:** `src/services/fracttalClient.js:27`-`33`: axios request interceptor calls `await this.getAccessToken()` on every outbound request. The method checks expiry locally so it's cheap when the token is fresh, but it's a synchronous bottleneck on a hot path.
- **Files:** `src/services/fracttalClient.js:27`-`33`, `src/services/fracttalClient.js:215`-`233`
- **Impact:** Negligible — `getAccessToken()` is `O(1)` when the token is valid. Mentioned for completeness; if the token logic ever loads from disk (it does today on the first call, see `authenticate()` line 106), every interceptor invocation could touch disk.
- **Fix approach:** Cache the token in-memory after first load; only re-load from disk on demand.

### PERF-5 — Winston JSON formatter on every log line
- **Severity:** Low
- **Issue:** `src/config/logger.js:14`-`20`: every log call goes through `format.combine(timestamp, errors{stack:true}, json())`. With ~3 log lines per item × 5,000 items = 15,000 JSON serializations per sync.
- **Files:** `src/config/logger.js`
- **Impact:** Minor CPU overhead during sync. Not a real concern at current scale.
- **Fix approach:** N/A unless sync runs > 1h on small CPUs. Logging is bounded by `LOG_MAX_SIZE` rotation; runaway is unlikely.

---

## Known Bugs / Limitations

### KB-1 — `tests/services/fracttalClient.test.js > updateWarehouseItem` is broken
- **Severity:** Medium
- **Issue:** `tests/services/fracttalClient.test.js:238`-`256`: expects `PUT /items/item1` but the deprecated method now forwards to `/inventories_adjustment/item1` (`src/services/fracttalClient.js:265`-`269` → `adjustInventoryStock` at line 472 → `PUT /inventories_adjustment/${itemCode}`).
- **Files:** `tests/services/fracttalClient.test.js:238`-`256`; tracked in `.planning/phases/02-enforcement-surface/deferred-items.md`.
- **Impact:** Red test. May mask other regressions when developers ignore it as "pre-existing".
- **Fix approach:** Per the deferred items doc, "Update the test expectation to match the current implementation path, or fix the implementation path". Recommend: delete the deprecated method (see TD-1) and delete the test.

### KB-2 — Real-time sync is out of scope
- **Severity:** N/A (by design)
- **Issue:** Per `CLAUDE.md` "Out of scope" and `.planning/PROJECT.md`: cron-based sync is the chosen approach. No CDC, no triggers, no webhook listener.
- **Files:** N/A
- **Impact:** Up to 24h staleness on a default daily cron. Customers needing real-time inventory cannot use SageSync.
- **Fix approach:** Don't fix. Document in customer-facing material.

### KB-3 — Single-tenant per deployment
- **Severity:** N/A (by design)
- **Issue:** Each SageSync install services one Sage300 instance + one Fracttal tenant. `config.json`, `.env`, and `.fracttal-token` are single-valued.
- **Files:** N/A
- **Impact:** Multi-tenant customers need N SageSync deployments — N Windows Services, N `.env` files, N License keys.
- **Fix approach:** Don't fix in current architecture. A multi-tenant rewrite would require config-per-tenant, separate logging streams, and per-tenant license validation — a significant lift.

### KB-4 — In-band license re-validation pauses cron tick
- **Severity:** Medium
- **Issue:** Same as FA-6. Filed separately as a known limitation since it's deliberate per `docs/MEMORY.md` section 1.7.
- **Files:** `src/main.js:62`, `src/app.js:22`
- **Impact:** Up to 10s pause per tick if license server is slow.
- **Fix approach:** Out-of-band timer for license re-validation (see FA-6).

### KB-5 — Two-step Case C has no atomic rollback
- **Severity:** Medium
- **Issue:** Same as FA-2. Filed as known limitation.
- **Files:** `src/app.js:119`-`139`
- **Impact:** Items created with stock=0 if `adjustInventoryStock` fails after `createInventoryWithWarehouse` succeeds.
- **Fix approach:** Retry queue (see FA-2). Until then, accept that next cron tick will re-detect the mismatch and call `adjustInventoryStock` for any item with stale stock.

### KB-6 — `getLastSyncInfo()` returns no real information
- **Severity:** Low
- **Issue:** `src/services/sageService.js:115`-`130`: returns `SELECT GETDATE() AS CurrentTime, 'Sage300' AS Source`. There's no last-sync tracking in Sage300 (and there shouldn't be — SageSync is read-only on Sage). The comment at line 118 acknowledges this: "Podrías crear una tabla para trackear esto".
- **Files:** `src/services/sageService.js:115`-`130`
- **Impact:** Dashboard or callers expecting `getLastSyncInfo()` to return useful data are misled.
- **Fix approach:** Move "last sync" tracking to a local SQLite or to `SyncStateManager` persistence (see FA-7). Remove or rename `getLastSyncInfo()` to `getCurrentSageTime()` which is what it actually does.

### KB-7 — Sister projects out of scope but coupled via HMAC
- **Severity:** Low
- **Issue:** Per `CLAUDE.md`: `../sageconnect/` and `../sageconnect-license/` are out of scope. But `HMAC_SECRET` is shared between SageSync and SageConnect (per `docs/MEMORY.md` section 1.2). Rotating it requires coordinated redeploys across both products.
- **Files:** N/A in SageSync; coupling lives in the license server.
- **Impact:** Operations cost. A `HMAC_SECRET` rotation is a multi-customer change.
- **Fix approach:** Split secrets per-product on the license server. Until then, document the coordination requirement in `RUNBOOK.md`.

---

## Fragile Areas Marked "Don't Touch" in CLAUDE.md

These are reproduced for completeness — they are not new findings but they are explicitly load-bearing per the project lead. Cross-reference any future modification with the listed test files and historical context.

| Area | File | Why fragile | Safety net |
|------|------|-------------|------------|
| LicenseValidator | `src/services/LicenseValidator.js` | HMAC + freshness + TTL + DNS + 3-state cache. Any change risks breaking enforcement. | `tests/services/LicenseValidator.test.js` and `docs/MEMORY.md` sections 1.1, 1.6 |
| Two-step Case C | `src/app.js:119`-`139` | `createInventoryWithWarehouse` + `adjustInventoryStock` is non-optional — `POST /inventories/` forces stock=0 by Fracttal API design. | `docs/MEMORY.md` section 2.2; `tests/manual/test-workflow.js` |
| Obfuscate script | `scripts/obfuscate.js` | Production distribution depends on it. Force-pushes to `SageSync-dist`. | Test with `--dry-run` style behavior (no `--push`) before changing options. |
| `requireLicense` exemption wrapper | `src/main.js:38`-`42` | Single-responsibility middleware design; exemption path lives at integration point. | `tests/integration/licenseEnforcement.test.js` |
| Obfuscate workflow | `.github/workflows/obfuscate-deploy.yml` | CI pipeline that pushes to `SageSync-dist`. Depends on `OBFUSCATED_REPO_TOKEN` secret. | GitHub Actions logs; secret rotation procedure |
| License gate ordering | `src/main.js:22`-`44` | `validateEnv` → `validateLicense({startup:true})` → `express.json` → `requireLicense` wrapper → `express.static` → routes → `errorHandler`. | Integration test gap (recommend adding — see FA-1) |

---

## Test Coverage Gaps

### TC-1 — No regression test for license gate ordering in `main.js`
- **What's not tested:** That `requireLicense` middleware runs before `express.static`, that `/api/system/license` is exempt, and that the chain breaks correctly when the license state is INVALID/ERROR.
- **Files:** `src/main.js` (no equivalent integration test that mounts the full chain).
- **Risk:** Someone reorders the middleware and breaks gating without any test failing.
- **Priority:** High

### TC-2 — No test for "main.js + app.js running in parallel"
- **What's not tested:** That two cron schedulers don't fire the same sync.
- **Files:** `src/main.js:59`, `src/app.js:191`
- **Risk:** Operator runs both processes; production sees duplicate writes.
- **Priority:** Low (operational, not code — but a process-level invariant docs/RUNBOOK warning would help).

### TC-3 — No test for `SyncStateManager` persistence
- **What's not tested:** N/A — there is no persistence to test (in-memory only).
- **Files:** `src/services/syncStateManager.js`
- **Risk:** Audit gap; reload loses state.
- **Priority:** Medium (depends on FA-7 fix).

### TC-4 — `tests/manual/test-workflow.js` requires real Fracttal credentials
- **What's not tested:** Cannot run in CI. Manual execution by operator.
- **Files:** `tests/manual/test-workflow.js`
- **Risk:** Fracttal API breaking changes go undetected until a manual run.
- **Priority:** Medium. Recommend nightly scheduled job with sandbox credentials.

### TC-5 — No test for `database.isConnected()` typo
- **What's not tested:** `src/config/database.js:94` has incorrect logic but no caller. See TD-8.
- **Files:** `src/config/database.js`
- **Risk:** Future caller relies on broken method.
- **Priority:** Low

---

## Summary Matrix

| Concern | Severity | File(s) | Status |
|---------|----------|---------|--------|
| TD-1 deprecated Fracttal methods | Medium | `src/services/fracttalClient.js` | Open |
| TD-2 language mixing | Low | project-wide | Accepted |
| TD-3 dual entry points | Medium | `main.js`, `app.js`, `sync.js` | Accepted/Document |
| TD-4 console+winston mixing | Low | `fracttalClient.js`, others | Open |
| TD-5 placeholder defaults | Medium | `sageService.js`, `fracttalClient.js` | Open |
| TD-6 hardcoded `LOCATION = 'GRAL'` | Medium | `src/services/sageService.js:23` | Open |
| TD-7 dead `transformToFracttalFormat` | Low | `src/services/sageService.js:132` | Open |
| TD-8 `isConnected()` typo | Low | `src/config/database.js:94` | Open |
| TD-9 unused `node-windows` | Low | `package.json` | Open |
| FA-1 license gate ordering | High | `src/main.js:22-44` | Locked-down |
| FA-2 two-step Case C no rollback | High | `src/app.js:119-139` | Locked-down |
| FA-3 per-item error swallowing | Medium | `src/app.js:148-154` | Open |
| FA-4 obfuscation pipeline | High | `scripts/obfuscate.js`, workflow | Locked-down |
| FA-5 exemption wrapper | Medium | `src/main.js:38-42` | Locked-down |
| FA-6 in-band license re-validation | Medium | `main.js:62`, `app.js:22` | Accepted |
| FA-7 in-memory `SyncStateManager` | Medium | `src/services/syncStateManager.js` | Open |
| FA-8 `validateEnv()` at module load | Medium | `src/app.js:13` | Documented |
| FA-9 force-push to dist | High | obfuscate.js + workflow | Open |
| SEC-1 HMAC prefix logging | High | `LicenseValidator.js:128-130` | Open |
| SEC-2 DNS bypass non-blocking | Medium | `LicenseValidator.js:181-201` | Accepted |
| SEC-3 secret-bearing files on disk | High | `.env`, `.fracttal-token` | Documented |
| SEC-4 SQL parameterization (no issue) | Low | `sageService.js`, `database.js` | OK |
| SEC-5 errorHandler logs req.body | Medium | `src/middleware/errorHandler.js` | Open |
| SEC-6 obfuscation is not security | Low | `scripts/obfuscate.js` | Documented |
| PERF-1 sequential item processing | High | `src/app.js:53-155` | Open |
| PERF-2 per-item ensureWarehouseExists | High | `src/app.js:77-85` | Open |
| PERF-3 MSSQL pool reconnect | Medium | `src/config/database.js:33-35` | Open |
| PERF-4 getAccessToken hot path | Low | `fracttalClient.js:27-33` | Acceptable |
| PERF-5 Winston JSON overhead | Low | `src/config/logger.js` | Acceptable |
| KB-1 broken `updateWarehouseItem` test | Medium | `tests/services/fracttalClient.test.js:238` | Deferred |
| KB-2 real-time sync out of scope | N/A | — | Accepted |
| KB-3 single-tenant | N/A | — | Accepted |
| KB-4 in-band license pauses tick | Medium | `main.js:62` | Accepted |
| KB-5 Case C no atomic rollback | Medium | `src/app.js:119-139` | Accepted |
| KB-6 `getLastSyncInfo()` returns nothing | Low | `sageService.js:115-130` | Open |
| KB-7 sister projects share HMAC | Low | external | Documented |
| TC-1 missing license-ordering test | High | `tests/integration/` | Open |
| TC-2 dual-cron invariant test | Low | `tests/integration/` | Operational |
| TC-3 syncStateManager persistence test | Medium | `tests/services/` | Open |
| TC-4 manual workflow needs creds | Medium | `tests/manual/test-workflow.js` | Open |
| TC-5 `isConnected()` typo test | Low | `tests/config/` | Open |

---

*Concerns audit: 2026-05-14*
