# SageSync — Milestones

## v1.0 — Core Sync Engine (Shipped)

**Shipped:** Pre-GSD
**Phases:** 0 (pre-existing)

**What shipped:**
- Sage300 MSSQL inventory reader
- Fracttal API client with OAuth2
- Automated cron-based inventory synchronization
- Express web dashboard
- Warehouse auto-creation and item association
- Windows service support
- Code obfuscation GitHub Action

**Validated requirements:** 10

---

## v1.1 — License Control System (Shipped)

**Shipped:** 2026-04-08
**Archived:** 2026-05-14
**Phases:** 1–2 (2 phases, 4 plans, 12 requirements)
**Tag:** `v1.1`
**Git range:** `851f1a4` (phase 1 research) → `8739958` (phase 2 plan close)
**Code changes:** 22 files, +2,962 / −148 LOC across `src/`, `tests/`, and dashboard assets

**What shipped:**
- `LicenseValidator` service (HMAC-signed, three-state cache VALID/INVALID/ERROR with 24h ERROR→INVALID TTL, startup retry + periodic re-validation)
- `requireLicense` Express middleware (returns 503 on non-exempt routes when license invalid)
- `GET /api/system/license` status endpoint (always accessible, 6-field response)
- License-gated cron tick (skips `syncInventory` with `warn` log when not VALID)
- Frontend enforcement surface — sticky banner, full-page blocking overlay, expiry countdown badge, 60s polling
- Env validation (`src/utils/validateEnv.js`) + license config module (`src/config/license.js`)
- 23-test `LicenseValidator` suite + 6 `requireLicense` middleware tests + integration tests
- DNS bypass detection (logs warning when license server resolves to private/loopback IP)

**Validated requirements:** 12 (LIC-01..04, ENF-01..04, STS-01..02, CFG-01..02)
**Deferred / known issues:** 1 — `tests/services/fracttalClient.test.js` `updateWarehouseItem` assertion mismatch (pre-existing v1.0 test bug, see `.planning/milestones/v1.1-ROADMAP.md` § Issues Deferred)

**Key decisions:** Port `LicenseValidator` from SageConnect; reuse `sageconnect-license.vercel.app`; two-tier license gate (startup retry+exit + periodic cron); `requireLicense` exemption wrapper in `main.js`; no email alerts; layered banner/overlay (z-index 1050/1049).

See `.planning/milestones/v1.1-ROADMAP.md` and `.planning/milestones/v1.1-REQUIREMENTS.md` for full archive.
