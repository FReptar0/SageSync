---
phase: 2
slug: enforcement-surface
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-07
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 29.7.0 |
| **Config file** | `jest.config.js` (project root) |
| **Quick run command** | `npx jest tests/services/requireLicense.test.js --no-coverage` |
| **Full suite command** | `npx jest --no-coverage` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx jest tests/services/requireLicense.test.js --no-coverage`
- **After every plan wave:** Run `npx jest --no-coverage`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | ENF-01 | unit | `npx jest tests/services/requireLicense.test.js -t "returns 503" --no-coverage` | ❌ W0 | ⬜ pending |
| 02-01-02 | 01 | 1 | ENF-01 | integration | `npx jest tests/integration/licenseEnforcement.test.js --no-coverage` | ❌ W0 | ⬜ pending |
| 02-01-03 | 01 | 1 | ENF-02 | unit | `npx jest tests/services/requireLicense.test.js -t "cron" --no-coverage` | ❌ W0 | ⬜ pending |
| 02-01-04 | 01 | 1 | STS-01 | integration | `npx jest tests/integration/licenseEnforcement.test.js -t "status endpoint" --no-coverage` | ❌ W0 | ⬜ pending |
| 02-01-05 | 01 | 1 | STS-02 | manual | N/A — no headless browser | manual | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/services/requireLicense.test.js` — unit tests for ENF-01 (middleware), ENF-02 (cron log level)
- [ ] `tests/integration/licenseEnforcement.test.js` — supertest integration for ENF-01 (route blocking), STS-01 (endpoint fields)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Dashboard shows license banner when INVALID | STS-02 | No headless browser in test suite | Set license to invalid, open dashboard, verify red banner appears |
| Expiry countdown shows at ≤30 days | STS-02 | Requires mock of expiresAt in frontend | Mock /api/system/license response with near-future expiresAt |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
