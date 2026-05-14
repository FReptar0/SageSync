# Technology Stack

**Analysis Date:** 2026-05-14

## Languages

**Primary:**
- JavaScript (CommonJS, ES2022) - All application code under `src/`, `scripts/`, `tests/`. No TypeScript.

**Secondary:**
- PowerShell 5.1+ - `scripts/install-service.ps1` (Windows Service installer via Servy)
- SQL (T-SQL for Microsoft SQL Server) - Inline queries in `src/services/sageService.js` against `COPDAT.dbo.ICILOC ⋈ ICITEM`
- YAML - GitHub Actions workflow at `.github/workflows/obfuscate-deploy.yml`

## Runtime

**Environment:**
- Node.js 18 (pinned via `NODE_VERSION: '18'` in `.github/workflows/obfuscate-deploy.yml`)
- Target: Windows Server (deployed as a Windows Service via Servy). Development on macOS/Linux is supported but production is on-premise Windows.
- No `.nvmrc` file present; Node version is enforced through CI and documented in `CLAUDE.md`.

**Package Manager:**
- npm
- Lockfile: `package-lock.json` (lockfileVersion 3) - present and committed
- CI installs via `npm ci` (see `.github/workflows/obfuscate-deploy.yml`)

## Frameworks

**Core:**
- Express 4.18.2 (`express` in `package.json`) - HTTP server, mounted in `src/main.js`. Serves the dashboard from `public/` and the `/api` routes mounted in `src/routes/index.js`.
- node-cron 3.0.3 (`node-cron`) - Scheduled inventory sync. Default schedule `'0 2 * * *'` (daily at 2 AM) configurable via `SYNC_CRON_SCHEDULE`. Used in both `src/main.js` and `src/app.js`.

**Testing:**
- Jest 29.7.0 (`jest`) - Test runner. Config: `jest.config.js`. Test root: `tests/`. Test timeout: 30s. Coverage collection from `src/**/*.js` (excludes `src/config/logger.js`).
- supertest 6.3.4 (`supertest`) - HTTP assertions against Express app.

**Build/Dev:**
- nodemon 3.0.1 (`nodemon`) - Dev auto-restart. `npm run dev` (wraps `src/main.js`) and `npm run dev-sync` (wraps `src/app.js`).
- javascript-obfuscator 5.4.1 (`javascript-obfuscator`) - Production distribution. Driven by `scripts/obfuscate.js`, triggered by CI (`.github/workflows/obfuscate-deploy.yml`), not by hand.

## Key Dependencies

**Critical (production):**
- axios 1.6.0 (`axios`) - All HTTP calls. Used in `src/services/fracttalClient.js` (Fracttal REST API + OAuth) and `src/services/LicenseValidator.js` (dedicated `licenseClient` instance with 10s timeout).
- mssql 10.0.1 (`mssql`) - Microsoft SQL Server driver. Used by `src/config/database.js` for read-only Sage300 access.
- winston 3.11.0 (`winston`) - Logger singleton at `src/config/logger.js`. File transports for `logs/sagesync.log` and `logs/error.log` with 10MB x 5 rotation. Console transport only when `NODE_ENV !== 'production'`.
- node-cron 3.0.3 (`node-cron`) - See Frameworks.
- dotenv 16.3.1 (`dotenv`) - `.env` loader. Required at the top of `src/main.js`, `src/app.js`, `src/sync.js`, and every config module.
- moment 2.29.4 (`moment`) - Date utilities (declared in `package.json`; no direct usage detected in core sync path, present for log parsing helpers).

**Infrastructure:**
- express 4.18.2 - See Frameworks.
- node-windows 1.0.0-beta.8 (`node-windows`) - Declared but unused in production. Wraps `src/service-installer.js` (referenced via `npm run install-service` / `uninstall-service`). Production uses Servy (PowerShell + `scripts/install-service.ps1`) instead.

**Built-in Node modules used (notable):**
- `crypto` - HMAC-SHA256 signature verification in `src/services/LicenseValidator.js`
- `dns` - `dns.resolve4()` defense-in-depth check (bypasses hosts file) in `src/services/LicenseValidator.js`
- `url` - URL parsing in license validator
- `fs`, `path` - File I/O across `src/config/configManager.js`, `src/config/logger.js`, `scripts/obfuscate.js`

## Configuration

**Environment:**
- Configured exclusively through `.env` (loaded by `dotenv` in every entry point).
- Validation at boot via `src/utils/validateEnv.js`. Process exits with code 1 if any required variable is missing. Grouped requirements:
  - **license:** `LICENSE_API_URL`, `HMAC_SECRET`, `SAGESYNC_API_KEY`
  - **database:** `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
  - **fracttal:** `FRACTTAL_CLIENT_ID`, `FRACTTAL_CLIENT_SECRET`
- Optional env vars: `DB_PORT` (default 1433), `DB_ENCRYPT`, `DB_TRUST_SERVER_CERTIFICATE`, `FRACTTAL_BASE_URL` (default `https://app.fracttal.com/api`), `FRACTTAL_OAUTH_URL` (default `https://one.fracttal.com/oauth/token`), `SYNC_TIMEOUT` (default 30000ms), `PORT` (default 3000), `SYNC_CRON_SCHEDULE` (default `'0 2 * * *'`), `SYNC_ON_STARTUP`, `LOG_LEVEL`, `LOG_FILE`, `LOG_MAX_SIZE`, `LOG_MAX_FILES`, `LOG_DIRECTORY`, `LOG_MAX_LINES`, `LOG_UPDATE_INTERVAL`, `DEFAULT_PAGINATION_LIMIT`, `MAX_PAGINATION_LIMIT`, `NODE_ENV`.
- `.env` is gitignored (`.gitignore` line 76). `.env` exists locally but is treated as secret material — never read by mapping tooling.

**Build:**
- `jest.config.js` - Jest configuration (test runner, coverage, timeout).
- `package.json` - Single source of dependencies and npm scripts.
- `scripts/obfuscate.js` - Build config for the dist pipeline (obfuscator options, copy-as-is list, exclusion list).

**Runtime mapping config:**
- `config.json` - Sage location -> Fracttal warehouse mapping (`locationMapping`), `defaultWarehouse`, `syncSettings` (batch size, retries, retry delay, log level), `warehouseCreationSettings` (auto-create defaults). Loaded by `src/config/configManager.js`.

## Platform Requirements

**Development:**
- Node.js 18.x
- npm (lockfile v3)
- Access to a Sage300 SQL Server instance for `npm test:sage` and integration runs (read-only credentials)
- Fracttal sandbox credentials for `npm run test:workflow`

**Production:**
- Windows Server (Windows Service deployment)
- Servy CLI installed (`winget install servy`) - manages auto-start, restart on crash, log rotation
- Node.js installed at `C:\Program Files\nodejs\node.exe` (default in `scripts/install-service.ps1`)
- Install directory `E:\SageSync` by default (`scripts/install-service.ps1` `-InstallDir`)
- Default listening port: 3000 (Servy parameter, overridable)
- Health monitoring: 30s heartbeat, max 3 failed checks, restart action, up to 5 restart attempts (configured in `scripts/install-service.ps1`)
- Log rotation: Servy-managed 10MB x 5 (`logs/servy-stdout.log`, `logs/servy-stderr.log`) plus Winston-managed (`logs/sagesync.log`, `logs/error.log`)

**Distribution:**
- `dist/` is built by `scripts/obfuscate.js` (obfuscated `src/**/*.js`, copy-as-is for `package.json`, `package-lock.json`, `jest.config.js`, `public/`, `config.json`, `.env.example`). CI pushes the artifact to `FReptar0/SageSync-dist` via `.github/workflows/obfuscate-deploy.yml` using the `OBFUSCATED_REPO_TOKEN` secret.

---

*Stack analysis: 2026-05-14*
