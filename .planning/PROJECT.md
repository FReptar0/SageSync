# SageSync

## What This Is

A Node.js service that synchronizes inventory data from Sage300 ERP to Fracttal (asset management platform), with a web dashboard for monitoring, cron-based automated sync, manual API triggers, and the ability to run as a Windows service. Deployed on-premise at Tersoft client sites. As of v1.1, the service is license-gated — Tersoft can remotely revoke a client's instance via the `sageconnect-license` server.

## Core Value

Sage300 inventory data stays in sync with Fracttal automatically, without manual intervention, and only while the client's deployment holds a valid Tersoft-issued license.

## Current State

**Latest shipped:** v1.1 License Control System (2026-04-08)

- v1.0 — Core Sync Engine (shipped pre-GSD)
- v1.1 — License Control System (shipped 2026-04-08, 2 phases / 4 plans / 12 requirements)

The codebase is ~3,300 LOC of Node.js (Express 4.18 + axios 1.6 + mssql 10 + node-cron 3 + winston 3), packaged for on-premise Windows-Server deployment via Servy. Distribution goes through a CI obfuscation pipeline to `SageSync-dist`. Project is in maintenance mode after a 2026-05-12 handoff; the codebase has been mapped to `.planning/codebase/` for the new owner.

## Next Milestone Goals

Not yet defined. Candidate themes carried over from v1.1 close:

- Pay down deferred test (`fracttalClient.test.js` `updateWarehouseItem`) and audit other deprecated FracttalClient methods (`createInventoryItem`, `updateWarehouseItem`) for removal.
- Reduce language drift (Spanish/English mix by file age) and document the convention more visibly.
- Operational hardening surfaced during handoff (RUNBOOK gaps, deployment-checklist gaps).

Run `/gsd-new-milestone` to scope v1.2 formally.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

**v1.0 — Core Sync Engine:**

- ✓ MSSQL connection to Sage300 for reading inventory data — v1.0
- ✓ Fracttal REST API integration (OAuth, inventory CRUD, warehouse management) — v1.0
- ✓ Automated cron-based inventory synchronization — v1.0
- ✓ Express web dashboard with status monitoring — v1.0
- ✓ Manual sync trigger via API — v1.0
- ✓ Warehouse auto-creation and item association in Fracttal — v1.0
- ✓ Winston logging with rotation — v1.0
- ✓ Windows service installation/uninstallation — v1.0
- ✓ Graceful shutdown handling — v1.0
- ✓ Code obfuscation pipeline with GitHub Actions — v1.0

**v1.1 — License Control System:**

- ✓ License validated on startup with retry+backoff (LIC-01) — v1.1
- ✓ License revalidated periodically on every cron tick (LIC-02) — v1.1
- ✓ HMAC-SHA256 signature verification on license response (LIC-03) — v1.1
- ✓ Timestamp freshness check (≤5 min) on license response (LIC-04) — v1.1
- ✓ API routes return 503 when license invalid, except `/api/system/license` (ENF-01) — v1.1
- ✓ Cron sync skipped when license invalid (ENF-02) — v1.1
- ✓ Startup exits with code 1 after 3 failed validation attempts (ENF-03) — v1.1
- ✓ Three-state cache (VALID/INVALID/ERROR) with 24h ERROR→INVALID TTL (ENF-04) — v1.1
- ✓ `GET /api/system/license` status endpoint always accessible (STS-01) — v1.1
- ✓ Dashboard banner/overlay/expiry-badge with 60s polling (STS-02) — v1.1
- ✓ License config via env (`LICENSE_API_URL`, `HMAC_SECRET`, `SAGESYNC_API_KEY`) (CFG-01) — v1.1
- ✓ DNS bypass detection (private/loopback IP) logs warning (CFG-02) — v1.1

### Active

<!-- Current scope. Building toward these. -->

(None — between milestones. See "Next Milestone Goals" above.)

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- Real-time sync — Cron-based is sufficient for inventory data that changes infrequently
- Multi-tenant — Each client gets their own deployment
- Web-based configuration UI — Config managed via `.env` and `config.json`
- Email alerts on license failure — User opted out at v1.1 start; Winston warnings sufficient
- Separate license server for SageSync — Reusing `sageconnect-license.vercel.app` is working well
- License dashboard/admin UI inside SageSync — Managed via the existing license server dashboard
- Offline license file fallback — 24h ERROR→INVALID TTL provides sufficient grace period

## Context

- Deployed on-premise at Tersoft client sites on Windows servers (production uses **Servy** for service management, not `node-windows`)
- Sage300 accessed via direct MSSQL connection (read-only) against `COPDAT.dbo.ICILOC ⋈ ICITEM`
- Fracttal accessed via REST API with OAuth2 token refresh; canonical methods are `createInventoryWithWarehouse`, `associateItemToWarehouse`, and `adjustInventoryStock` (legacy `createInventoryItem`/`updateWarehouseItem` are deprecated and slated for removal)
- License server: `sageconnect-license.vercel.app` (shared with SageConnect; each product registers its own client key)
- Sister project: **SageConnect** (handles payments, POS, CFDI — different domain, same client). Out of scope for this repo.
- Source code is mixed-language by file age — older files (`app.js`, `sageService.js`, `fracttalClient.js`, `maintenance.js`, `configManager.js`) are Spanish; v1.1 files (`LicenseValidator.js`, `requireLicense.js`, `validateEnv.js`, `license.js`) are English. User-facing logs are Spanish across the board.
- Distribution: CI workflow `.github/workflows/obfuscate-deploy.yml` obfuscates and pushes to `SageSync-dist` repo.
- Codebase map produced 2026-05-14 in `.planning/codebase/` (STACK, INTEGRATIONS, ARCHITECTURE, STRUCTURE, CONVENTIONS, TESTING, CONCERNS).
- Handoff package produced 2026-05-12 (HANDOFF.md, ARCHITECTURE.md, RUNBOOK.md, docs/MEMORY.md, docs/DEPLOYMENT.md).

## Constraints

- **Runtime**: Node.js 18 on Windows Server
- **Database**: Read-only access to Sage300 MSSQL
- **Deployment**: On-premise, not cloud-hosted
- **Dependencies**: Must work offline for extended periods (graceful degradation — 24h ERROR TTL in license validator)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Express + cron vs. pure CLI | Need web dashboard for client monitoring | ✓ Good — dashboard heavily used for license status visibility too |
| Direct MSSQL vs. Sage300 API | Sage300 API is limited; direct SQL gives full inventory access | ✓ Good |
| Code obfuscation for dist | Protect proprietary logic in client deployments | ✓ Good |
| Port LicenseValidator from SageConnect instead of rewriting | Proven HMAC + freshness logic, less risk | ✓ Good — saved ~3 days of work, no regressions |
| Reuse `sageconnect-license.vercel.app` server | Avoid running a second license backend | ✓ Good — only needed a new client key registration |
| No email alerts on license failure (log warnings only) | User opted out at v1.1 kickoff | ✓ Good — kept v1.1 scope tight |
| Two-tier license gate (startup + periodic) | Cover both boot and long-running cron cycles | ✓ Good — caught a sandbox revocation test cleanly |
| `requireLicense` exemption in `main.js` wrapper, not in middleware | Keep middleware single-responsibility | ✓ Good |
| Banner z-index 1050 above overlay z-index 1049 | Banner visible even when blocking overlay active | ✓ Good — operator can still read state while UI is blocked |
| Servy over node-windows for production service | Better recovery + log capture on Windows Server | ✓ Good (decision predates v1.1, validated under v1.1 deployments) |

---
*Last updated: 2026-05-14 after v1.1 milestone close.*
