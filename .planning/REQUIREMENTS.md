# Requirements: SageSync

**Defined:** 2026-04-07
**Core Value:** Sage300 inventory data stays in sync with Fracttal automatically

## v1.1 Requirements

Requirements for license control system. Each maps to roadmap phases.

### License Validation

- [ ] **LIC-01**: App validates license against remote server on startup (3 retries with exponential backoff)
- [ ] **LIC-02**: App validates license periodically on each cron sync cycle
- [ ] **LIC-03**: License response verified via HMAC-SHA256 signature with shared secret
- [ ] **LIC-04**: Timestamp freshness check rejects responses older than 5 minutes

### License Enforcement

- [ ] **ENF-01**: All API routes except /api/system/license return 503 when license is invalid
- [ ] **ENF-02**: Cron sync cycles are skipped when license is invalid
- [ ] **ENF-03**: App exits with code 1 if license validation fails at startup after retries
- [ ] **ENF-04**: Three-state cache model (VALID/INVALID/ERROR) with 24h ERROR→INVALID TTL

### License Status

- [ ] **STS-01**: GET /api/system/license endpoint returns current license state (always accessible)
- [ ] **STS-02**: Frontend dashboard shows license status banner when invalid/expiring

### Configuration

- [ ] **CFG-01**: License configured via environment variables (LICENSE_API_URL, HMAC_SECRET, SAGESYNC_API_KEY)
- [ ] **CFG-02**: DNS bypass detection logs warning when license server resolves to private/loopback IP

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

(None)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Email alerts on license failure | User opted out — log warnings sufficient for SageSync |
| Separate license server | Reuse existing sageconnect-license.vercel.app |
| License dashboard/admin UI | Managed via existing license server dashboard |
| Offline license file fallback | 24h ERROR TTL provides sufficient grace period |

## Traceability

(Updated during roadmap creation)

| Requirement | Phase | Status |
|-------------|-------|--------|
| LIC-01 | — | Pending |
| LIC-02 | — | Pending |
| LIC-03 | — | Pending |
| LIC-04 | — | Pending |
| ENF-01 | — | Pending |
| ENF-02 | — | Pending |
| ENF-03 | — | Pending |
| ENF-04 | — | Pending |
| STS-01 | — | Pending |
| STS-02 | — | Pending |
| CFG-01 | — | Pending |
| CFG-02 | — | Pending |

**Coverage:**
- v1.1 requirements: 12 total
- Mapped to phases: 0
- Unmapped: 12 ⚠️

---
*Requirements defined: 2026-04-07*
*Last updated: 2026-04-07 after initial definition*
