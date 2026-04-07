# SageSync

## What This Is

A Node.js application that synchronizes inventory data from Sage300 ERP to Fracttal (asset management platform). It provides a web dashboard for monitoring, scheduled cron-based sync, manual API triggers, and can run as a Windows service. Deployed on-premise at Tersoft client sites.

## Core Value

Sage300 inventory data stays in sync with Fracttal automatically, without manual intervention.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

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

### Active

<!-- Current scope. Building toward these. -->

(See current milestone)

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- Real-time sync — Cron-based is sufficient for inventory data that changes infrequently
- Multi-tenant — Each client gets their own deployment
- Web-based configuration UI — Config managed via .env and config.json

## Context

- Deployed on-premise at Tersoft client sites on Windows servers
- Sage300 accessed via direct MSSQL connection (read-only)
- Fracttal accessed via REST API with OAuth2 token refresh
- Sister project: SageConnect (handles payments, POS, CFDI — different domain, same client)
- SageConnect v2.1 introduced a license validation system that Tersoft controls remotely

## Constraints

- **Runtime**: Node.js 18 on Windows Server
- **Database**: Read-only access to Sage300 MSSQL
- **Deployment**: On-premise, not cloud-hosted
- **Dependencies**: Must work offline for extended periods (graceful degradation)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Express + cron vs. pure CLI | Need web dashboard for client monitoring | ✓ Good |
| Direct MSSQL vs. Sage300 API | Sage300 API is limited; direct SQL gives full inventory access | ✓ Good |
| Code obfuscation for dist | Protect proprietary logic in client deployments | ✓ Good |

---
*Last updated: 2026-04-07 after project initialization*
