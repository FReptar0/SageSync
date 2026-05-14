# Roadmap: SageSync

## Milestones

- ✅ **v1.0 Core Sync Engine** — Pre-GSD (shipped, phases not tracked)
- ✅ **v1.1 License Control System** — Phases 1–2 (shipped 2026-04-08) — see [`milestones/v1.1-ROADMAP.md`](./milestones/v1.1-ROADMAP.md)
- 📋 **v1.2** — Not yet scoped (run `/gsd-new-milestone` to start)

## Phases

<details>
<summary>✅ v1.0 Core Sync Engine — SHIPPED (pre-GSD, phases not tracked)</summary>

Shipped with: MSSQL inventory reader, Fracttal API client with OAuth2, cron sync, Express dashboard, warehouse auto-creation, Windows service support, code obfuscation GitHub Action.

</details>

<details>
<summary>✅ v1.1 License Control System (Phases 1–2) — SHIPPED 2026-04-08</summary>

- [x] Phase 1: Validator Core (2/2 plans) — completed 2026-04-07
- [x] Phase 2: Enforcement Surface (2/2 plans) — completed 2026-04-08

Full archive: [`milestones/v1.1-ROADMAP.md`](./milestones/v1.1-ROADMAP.md)
Requirements archive: [`milestones/v1.1-REQUIREMENTS.md`](./milestones/v1.1-REQUIREMENTS.md)

</details>

### 📋 v1.2 (Not yet scoped)

Run `/gsd-new-milestone` to define goals, requirements, and phases. Candidate themes carried over from v1.1 close (`PROJECT.md` § Next Milestone Goals):

- Pay down deferred test (`fracttalClient.test.js` `updateWarehouseItem`) and audit deprecated FracttalClient methods for removal.
- Reduce Spanish/English language drift across the codebase and document the convention more visibly.
- Operational hardening surfaced during handoff (RUNBOOK gaps, deployment-checklist gaps).

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Validator Core | v1.1 | 2/2 | ✅ Complete | 2026-04-07 |
| 2. Enforcement Surface | v1.1 | 2/2 | ✅ Complete | 2026-04-08 |
