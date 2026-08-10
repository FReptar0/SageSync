---
gsd_state_version: 1.0
milestone: null
milestone_name: null
status: between-milestones
stopped_at: 2026-05-15 — partial test-server validation (steps 0-5 green); steps 6-9 handed off to next owner via TEST-SERVER-PLAYBOOK.md
last_updated: "2026-05-15T22:00:00.000Z"
last_activity: 2026-05-15 — Test-server validation steps 0-5 complete; sync:preview verde con 9,114 items; issue #14 filed; playbook for steps 6-9 written
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-14)

**Core value:** Sage300 inventory data stays in sync with Fracttal automatically, only while the client's deployment holds a valid Tersoft-issued license.
**Current focus:** Between milestones — v1.1 archived, v1.2 not yet scoped.

## Current Position

No active milestone. Run `/gsd-new-milestone` to scope v1.2 (or `/gsd-explore` for socratic ideation first).

Last shipped milestone: v1.1 License Control System (2026-04-08, 2 phases, 4 plans, 12 requirements, tag `v1.1`).

## Accumulated Context

### Decisions (carried forward — most important)

- License subsystem design (v1.1): two-tier gate (startup retry+exit + periodic cron), `LicenseValidator` ported from SageConnect, `sageconnect-license.vercel.app` reused with new client key, `requireLicense` exemption in `main.js` wrapper (middleware stays single-responsibility), no email alerts (Winston warn only), banner z-index 1050 above overlay z-index 1049.
- Codebase mapped 2026-05-14 → `.planning/codebase/` (7 docs, ~2,000 lines). Use as the read-once primer for new work.

Full decision log for v1.1 is preserved in `.planning/milestones/v1.1-ROADMAP.md` § Key Decisions.

### Pending Todos

- **Carga diaria/delta a Fracttal (baja prioridad, requisito de auditoría):** query de Santiago YA integrado tal cual en `sageService.getMovedInventoryItems()` (2026-08-07). Pendientes antes de producción: (1) stock quedó en on-hand (`QTYONHAND`) vs. disponible de la carga inicial — vigilar inconsistencia en Fracttal; (2) fecha `'20260806'` quemada → hacerla dinámica para el cron; (3) filtros de familia quemados en la query en vez de leerse de config.json; (4) verificar en el server que `ICIVAL.AUDTDATE` se mueva en cada movimiento. Falta commit.

### Blockers/Concerns

- **CRITICAL — issue #13 (2026-05-15):** `PUT /inventories_adjustment/` returns HTTP 400 on warehouses with `external_integration: true`. COZAMIN 1 in prod has this flag. **Sync entirely fails against COZAMIN 1 as currently designed.** Mitigation applied to `config.json` (default for new warehouses now `false`) but does NOT resolve COZAMIN 1. Two paths: (A) operational — Tersoft + client change flag in Fracttal UI; (B) technical — refactor sync to entries/exits delta (backlog 999.3). Must resolve before any prod deploy. See `docs/NEXT-STEPS.md` § D5 + Fase 0.

### Deferred Items (acknowledged at v1.1 close)

| Category | Item | Status |
|----------|------|--------|
| test | `tests/services/fracttalClient.test.js` — `updateWarehouseItem` asserts wrong endpoint (`/items/item1` vs actual `/inventories_adjustment/item1`) | Pre-existing v1.0 bug; carry to v1.2. Source: `.planning/milestones/v1.1-phases/02-enforcement-surface/deferred-items.md` (if archived) or `.planning/phases/02-enforcement-surface/deferred-items.md` (if not yet moved) |

## Session Continuity

Last session: 2026-05-14T16:55:00.000Z
Stopped at: v1.1 archived — ready for v1.2 scoping
Resume file: None

## History

- **2026-04-07 → 2026-04-08** — Executed v1.1 License Control System (Phases 1–2, 4 plans, 12 requirements). Tag `v1.1`.
- **2026-05-12** — Handoff package assembled (`HANDOFF.md`, `ARCHITECTURE.md`, `RUNBOOK.md`, `docs/MEMORY.md`, `CLAUDE.md` + `.claude/` integration) by Fernando Rodriguez Memije (`fmemije00@gmail.com`). Branch: `chore/handoff-prep-2026-05`. No source under `src/` modified.
- **2026-05-14** — Codebase mapped to `.planning/codebase/` (commit `37b2cec`); v1.1 milestone formally closed and archived to `.planning/milestones/v1.1-*.md` + tagged `v1.1`. Family-filter sync implemented (commits `23556cb` → `4ed45a5`, 110/110 tests green). 11 issues filed (#2-#12) for post-handoff hardening; backlog 999.1 + 999.2 added.
- **2026-05-15** — E2E validation in test server revealed CRITICAL blocker: `external_integration: true` on integrated warehouses blocks `PUT /inventories_adjustment/` with HTTP 400. Issue #13 filed; backlog 999.3 added. `config.json` defaults patched to `external_integration: false` for new warehouses (mitigation only — does not resolve COZAMIN 1 in prod which already has the flag). Fase 0 added to `docs/NEXT-STEPS.md` action plan.
- **2026-05-15 (later)** — Test-server validation steps 0-5 completed: workflow E2E green, family-filter sync:preview verde con 9,114 items reales del Sage300 del cliente / Case B: 2,791 / Case C: 6,321 / 1 error transient (token rotation race). Issue #14 filed for token rotation. Inspector scripts shipped (`npm run inspect:warehouse`, `npm run inspect:warehouses`). Steps 6-9 (sync real, server up, visual UI verification, evidence packing) handed off to next owner via new `docs/TEST-SERVER-PLAYBOOK.md`.
- **2026-08-05** — Fracttal delta prep (acuerdo con Santiago, 4 reuniones jul-ago): duplicada la función de carga para separar carga inicial vs. diaria. Nuevos: `sageService.getMovedInventoryItems()` (query con placeholder `movedFilter` para el filtro de movimientos del día), `app.js syncInventoryMoved()` (copia fiel de `syncInventory`, única diferencia = fuente de datos), runner `npm run sync:moved[:preview]` vía flag `--moved` en `sync.js`. Carga inicial (`syncInventory`) intacta. Pendiente: query delta de Santiago. Deuda técnica: loop de 3 casos duplicado a propósito (candidato a refactor a motor compartido).
- **2026-08-07** — Fracttal delta: integrado el query que devolvió Santiago **tal cual** en `sageService.getMovedInventoryItems()` (delta vía `COPDAT.dbo.ICIVAL` + `GROUP BY`/`HAVING MAX(AUDTDATE)`). Decisión de Yahir: usar on-hand (`QTYONHAND`) como lo mandó Santi, aunque la carga inicial usa disponible (inconsistencia aceptada, a vigilar en Fracttal). Deudas documentadas en código: fecha quemada `'20260806'`, filtros de familia quemados, verificar `AUDTDATE` de ICIVAL. Único ajuste propio: calificar ICIVAL con `COPDAT.dbo.`. Sin commit aún.
