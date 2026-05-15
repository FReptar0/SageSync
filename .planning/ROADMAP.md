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

## Backlog

> Backlog (numeración 999.x): ideas pendientes de planificar, surgidas durante validación pre-deploy contra el tenant prod del cliente (id_company 779, ALMACEN GENERAL CAPSTONE GOLD/COZAMIN) el 2026-05-14. Promover a un milestone activo con `/gsd-review-backlog` cuando el nuevo owner las priorice.

### Phase 999.1: Operational hardening del sync periódico (BACKLOG)

**Goal:** Hacer robusto el modelo de actualización periódica de cara a producción sostenida. Cubre 10 gaps detectados al auditar la configuración actual del cron, la observabilidad y la resiliencia ante fallas.

**Requirements:** TBD — derivar de cada issue de GitHub.

**Plans:** 0 plans

**Issues asociados (GitHub):**
- [#3 — Op-1: Cron sin timezone explícito](https://github.com/FReptar0/SageSync/issues/3)
- [#4 — Op-2: Sin alerting cuando un sync falla](https://github.com/FReptar0/SageSync/issues/4)
- [#5 — Op-3: `/api/sync/health` con freshness check](https://github.com/FReptar0/SageSync/issues/5)
- [#6 — Op-4: Métricas exportables (Prometheus / Datadog)](https://github.com/FReptar0/SageSync/issues/6)
- [#7 — Op-5: Sin retry/backoff intra-día](https://github.com/FReptar0/SageSync/issues/7)
- [#8 — Op-6: `syncInventory` sin timeout total](https://github.com/FReptar0/SageSync/issues/8)
- [#9 — Op-7: Bug de concurrencia en `src/app.js` (sync-only mode)](https://github.com/FReptar0/SageSync/issues/9)
- [#10 — Op-8: `SyncStateManager.history` solo en memoria](https://github.com/FReptar0/SageSync/issues/10)
- [#11 — Op-9: License expiry sin warning proactivo](https://github.com/FReptar0/SageSync/issues/11)
- [#12 — Op-10: Documentar modelo de actualización periódica en RUNBOOK](https://github.com/FReptar0/SageSync/issues/12)
- [#14 — Op-11: Token rotation race — INVALID_TOKEN no detectado por interceptor](https://github.com/FReptar0/SageSync/issues/14)

Plans:
- [ ] TBD (promote with `/gsd-review-backlog` when ready)

### Phase 999.2: Semántica de inventario respetando curación operativa (BACKLOG)

**Goal:** Reescribir `syncInventory` para que NO sobreescriba `min_stock_level`, `max_stock_level`, `location`, `unit_code` ni `barcode` de items ya cargados manualmente en Fracttal. Sage300 debe ser source-of-truth solo para `stock` y `unit_cost_stock`. Incluye decisión de stakeholder sobre qué hacer con el almacén shell `ALM-AMP` vs el almacén operativo real `COZAMIN 1` ($43M, 787 requisiciones abiertas).

**Requirements:** TBD — derivar del issue.

**Plans:** 0 plans

**Issue asociado (GitHub):**
- [#2 — Sync semantics must respect operator-curated inventory in COZAMIN 1 (post-handoff)](https://github.com/FReptar0/SageSync/issues/2)

**Contexto crítico:** el trade-off de sobreescritura es **aceptado temporalmente** por Tersoft + cliente Capstone Gold/Cozamin. Este backlog item ataca la solución correcta cuando el nuevo owner del proyecto pueda hacer cambios disruptivos. Detalles completos en el issue.

Plans:
- [ ] TBD (promote with `/gsd-review-backlog` when ready)

### Phase 999.3: Refactor sync a entries/exits para almacenes integrados (BACKLOG)

**Goal:** Reemplazar la arquitectura actual del sync (basada en `PUT /inventories_adjustment/`, "stock absoluto") por un sync de "deltas de movimiento" usando `POST /warehouse_entries_orders/{warehouse_code}` y `POST /warehouse_outputs_orders/`. Necesario para que SageSync funcione contra cualquier almacén con `external_integration: true` en Fracttal — incluyendo COZAMIN 1 en prod del cliente Capstone Gold/Cozamin.

**Requirements:** TBD — derivar del issue.

**Plans:** 0 plans

**Issue asociado (GitHub):**
- [#13 — [CRITICAL] adjustInventoryStock bloqueado en almacenes integrados](https://github.com/FReptar0/SageSync/issues/13)

**Contexto crítico:** el endpoint `PUT /inventories_adjustment/` retorna HTTP 400 con mensaje literal `"Inventory adjustments cannot be made in integrated warehouses"` cuando el almacén tiene `external_integration: true`. Los tres casos del sync (Case A/B/C en `src/app.js:149-198`) terminan en `adjustInventoryStock`, así que **el sync entero falla** contra COZAMIN 1. Mitigación temporal aplicada: `warehouseCreationSettings.defaultValues.external_integration` cambiado a `false` para almacenes que SageSync cree en el futuro. **No resuelve COZAMIN 1 en prod.** Existe ruta alterna operativa (Tersoft + cliente cambian COZAMIN 1 a no-integrado en Fracttal UI) que sería más rápida; este backlog cubre la solución técnica si la ruta operativa no es viable.

Plans:
- [ ] TBD (promote with `/gsd-review-backlog` when ready)

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Validator Core | v1.1 | 2/2 | ✅ Complete | 2026-04-07 |
| 2. Enforcement Surface | v1.1 | 2/2 | ✅ Complete | 2026-04-08 |
| 999.1. Operational hardening del sync periódico | Backlog | 0/0 | 📋 Backlog | — |
| 999.2. Semántica de inventario respetando curación operativa | Backlog | 0/0 | 📋 Backlog | — |
| 999.3. Refactor sync a entries/exits para almacenes integrados | Backlog | 0/0 | 📋 Backlog | — |
