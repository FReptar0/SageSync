---
phase: 1
slug: validator-core
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-07
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 29.7.0 |
| **Config file** | `jest.config.js` (project root) |
| **Quick run command** | `npx jest tests/services/LicenseValidator.test.js --no-coverage` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx jest tests/services/LicenseValidator.test.js --no-coverage`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | CFG-01 | unit | `npx jest tests/services/LicenseValidator.test.js -t "config"` | ❌ W0 | ⬜ pending |
| 01-01-02 | 01 | 1 | CFG-02 | unit | `npx jest tests/services/LicenseValidator.test.js -t "dns"` | ❌ W0 | ⬜ pending |
| 01-01-03 | 01 | 1 | LIC-01 | unit | `npx jest tests/services/LicenseValidator.test.js -t "startup"` | ❌ W0 | ⬜ pending |
| 01-01-04 | 01 | 1 | LIC-02 | unit | `npx jest tests/services/LicenseValidator.test.js -t "periodic"` | ❌ W0 | ⬜ pending |
| 01-01-05 | 01 | 1 | LIC-03 | unit | `npx jest tests/services/LicenseValidator.test.js -t "hmac"` | ❌ W0 | ⬜ pending |
| 01-01-06 | 01 | 1 | LIC-04 | unit | `npx jest tests/services/LicenseValidator.test.js -t "timestamp"` | ❌ W0 | ⬜ pending |
| 01-01-07 | 01 | 1 | ENF-03 | unit | `npx jest tests/services/LicenseValidator.test.js -t "exit"` | ❌ W0 | ⬜ pending |
| 01-01-08 | 01 | 1 | ENF-04 | unit | `npx jest tests/services/LicenseValidator.test.js -t "error ttl"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/services/LicenseValidator.test.js` — stubs for all 8 requirements
  - Must mock: `axios`, `dns`, `../src/config/license`, `../src/config/logger`, `process.exit`
  - Global setup in `tests/setup.js` already mocks logger — test file still needs `jest.spyOn(process, 'exit')` for ENF-03

*Wave 0 creates test stubs before implementation begins.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| App refuses to start with invalid license key | ENF-03 | E2E requires real license server | Set invalid SAGESYNC_API_KEY, run `node src/main.js`, verify exit code 1 |
| DNS bypass warning logged | CFG-02 | Requires hosts file modification | Point LICENSE_API_URL to localhost in /etc/hosts, verify warning in logs |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
