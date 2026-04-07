# Roadmap: SageSync

## Milestones

- ✅ **v1.0 Core Sync Engine** - Pre-GSD (shipped, phases not tracked)
- 🚧 **v1.1 License Control System** - Phases 1-2 (in progress)

## Phases

<details>
<summary>✅ v1.0 Core Sync Engine — SHIPPED (pre-GSD, phases not tracked)</summary>

Shipped with: MSSQL inventory reader, Fracttal API client with OAuth2, cron sync, Express dashboard, warehouse auto-creation, Windows service support, code obfuscation GitHub Action.

</details>

### 🚧 v1.1 License Control System (In Progress)

**Milestone Goal:** Tersoft can remotely control whether SageSync operates at any client site. A tampered or revoked license prevents the app from running.

- [ ] **Phase 1: Validator Core** - LicenseValidator service + config wiring + startup gate
- [ ] **Phase 2: Enforcement Surface** - Route middleware + cron guard + status endpoint + frontend banner

## Phase Details

### Phase 1: Validator Core
**Goal**: The app validates its license on startup and refuses to start if the license cannot be confirmed
**Depends on**: Nothing (first GSD phase)
**Requirements**: CFG-01, CFG-02, LIC-01, LIC-02, LIC-03, LIC-04, ENF-03, ENF-04
**Success Criteria** (what must be TRUE):
  1. App reads LICENSE_API_URL, HMAC_SECRET, and SAGESYNC_API_KEY from environment and passes them to the validator
  2. App exits with code 1 on startup when license validation fails after 3 retries with exponential backoff
  3. A valid license response with a correct HMAC-SHA256 signature and fresh timestamp (under 5 minutes old) results in VALID state
  4. A network failure during validation transitions state to ERROR, and after 24h in ERROR state the app treats license as INVALID
  5. A license server hostname that resolves to a private or loopback IP triggers a logged warning (non-blocking)
**Plans:** 2 plans

Plans:
- [ ] 01-01-PLAN.md — Config module, env validator, and LicenseValidator port from sageconnect
- [ ] 01-02-PLAN.md — Unit tests for all 8 requirements and entry point wiring

### Phase 2: Enforcement Surface
**Goal**: Every operational path in the app is gated by license state, and the current state is visible to operators
**Depends on**: Phase 1
**Requirements**: ENF-01, ENF-02, STS-01, STS-02
**Success Criteria** (what must be TRUE):
  1. Any API request (except GET /api/system/license) returns HTTP 503 when license state is INVALID or ERROR-past-TTL
  2. Cron sync cycles are silently skipped and a warning is logged when license is not VALID
  3. GET /api/system/license returns a JSON object with current state, active flag, expiresAt, and lastChecked — always, regardless of license state
  4. The web dashboard displays a visible banner when license state is INVALID or a license is expiring
**Plans**: TBD

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Validator Core | v1.1 | 0/2 | Planned | - |
| 2. Enforcement Surface | v1.1 | 0/? | Not started | - |
