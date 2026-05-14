# Próximos pasos — SageSync

**Última actualización:** 2026-05-14
**Estado:** Family-filter sync implementado + 11 issues identificados durante validación contra prod. Listo para deploy en servidor de pruebas contra sandbox, **NO listo** para producción sin coordinación operativa previa.

---

## TL;DR (lee esto primero, 30 segundos)

1. **El código del family-filter sync está listo, testeado (110/110 verde), pusheado a `origin/main` y bien documentado**. Tag git: hasta `v1.1`; el trabajo de hoy aún sin tag (vive en `main` post-v1.1).
2. **NO deployes a producción sin antes**: corregir `config.json.locationMapping.GRAL.fracttalWarehouseCode` (hoy apunta al almacén equivocado) **y** coordinar con el equipo operativo de Cozamin sobre el manejo de las 787 requisiciones abiertas.
3. **Sí puedes deployar al servidor de pruebas** apuntando al **sandbox de Fracttal** (no al prod del cliente) usando `npm run sync:preview` primero, luego `npm run sync`. La configuración actual de `.env` ya apunta al sandbox.
4. Las 11 issues en GitHub (#2 a #12) son trabajo del nuevo owner del proyecto. Están agrupadas en 2 backlog items en `.planning/ROADMAP.md` (999.1 y 999.2).
5. Hay un goal de sesión Claude Code activo todavía — usa `/goal clear` cuando aceptes que la sesión está cerrada.

---

## Lo que se hizo en la sesión 2026-05-14

### Family-filter sync (mergeado a `main`, 6 commits)

`23556cb` → `4ed45a5` resuelve:

| Cambio | Archivo principal |
|---|---|
| `config.json` con sección `inventoryFilters` (`itemBracketId: 'FSA'` + 16 segmentos excluidos) | `config.json` |
| `ConfigManager.getInventoryFilters()` con defaults seguros | `src/config/configManager.js` |
| `SageService._buildInventoryQuery` con `I.FMTITEMNO` (no `B.ITEMNO`) y filtros opcionales | `src/services/sageService.js` |
| `syncInventory({ dryRun: true })` que clasifica items Case A/B/C sin escribir | `src/app.js` |
| `npm run sync:preview` + `POST /api/sync/preview` | `src/sync.js`, `src/controllers/syncController.js`, `src/routes/syncRoutes.js` |
| URL encoding defensiva (`encodeURIComponent`) en path segments | `src/services/fracttalClient.js` |
| 39 tests nuevos + fix del test diferido v1.1 (`fracttalClient.test.js` `updateWarehouseItem`) | `tests/` |
| Guía paso-a-paso de rollout sandbox→prod | `docs/FAMILY-FILTER-ROLLOUT.md` |

**Suite completa: 110/110 verde.** `npm test` lo confirma.

### Backlog items y issues abiertos

Pusheado a `origin/main`:

- **`.planning/ROADMAP.md`** ahora tiene sección `## Backlog`:
  - Phase **999.1** — Operational hardening del sync periódico (links a issues #3-#12)
  - Phase **999.2** — Semántica de inventario respetando curación operativa (link a issue #2)
- 11 GitHub issues abiertos en https://github.com/FReptar0/SageSync/issues

---

## Decisiones que necesitan stakeholder antes de prod

Cada una de estas requiere **input humano**. Nadie debe asumirlas sin confirmación.

### D1 — ¿Cuál es el almacén destino correcto?

Hoy `config.json` dice `ALM-AMP`. Validación contra prod reveló:

| Almacén | Items | Stock total | `external_integration` | ¿Es el destino real? |
|---|---|---|---|---|
| `ALM-AMP` | 0 | $0 | `false` | Probablemente NO (shell vacío) |
| `COZAMIN 1` | 3,124 | $43,296,623.97 | `true` | **Probablemente SÍ** |

**Stakeholder a contactar:** Sandra Pelaez (sandra.pelaez@tersoft.mx, admin del tenant prod 779) o el jefe operativo de Capstone Gold / Cozamin.

**Pregunta exacta:** "¿El sync de Sage300 debe llenar el almacén `COZAMIN 1` existente (con $43M de inventario cargado manualmente) o el almacén vacío `ALM-AMP`?"

Si la respuesta es `COZAMIN 1` → ir directo a D2 antes de tocar nada.
Si la respuesta es `ALM-AMP` → es la config actual, pero entonces hay 2 sistemas de inventario en paralelo, hay que decidir cuál es source-of-truth en operación.

### D2 — ¿Qué hacer con las 787 requisiciones de material abiertas?

Si destino es `COZAMIN 1`, hay **787 requisiciones de material** sin entregar (de 2024-2025) que consumen stock asignado. Un sync ciego sobreescribe los stocks con los valores de Sage300, lo cual:
- Descalibra cantidades pendientes (`qty_pending`, `qty_assigned`)
- Puede romper órdenes de trabajo en proceso (94 OTs en proceso en prod hoy)

**Stakeholder a contactar:** Jefe de Mantenimiento de Cozamin (el que aprueba las requisiciones).

**Opciones a presentar:**
- A) Cerrar todas las requisiciones pendientes antes del primer sync.
- B) Coordinar el primer sync con una ventana de pausa operativa (mantenimiento programado).
- C) Aceptar la disrupción como trade-off temporal y absorber el caos (esto fue aceptado por Tersoft, ver issue #2 — verificar si el cliente lo aceptó también).
- D) Implementar el fix del issue #2 (modo "stock-only" que no toca min/max/location/unit) antes del primer sync. **Solución correcta pero requiere desarrollo.**

### D3 — ¿Quién prioriza los 11 issues post-handoff?

Los issues #2-#12 están etiquetados `help wanted`. Hay que decidir:
- ¿Tersoft toma uno o más para hacer durante este ciclo?
- ¿Se entregan al cliente para que ellos los presupuesten?
- ¿Esperamos a que el cliente reporte síntomas (timezone drift, license expiry, etc.)?

Recomendación práctica: **arreglar los 3 críticos antes de prod** (#3 timezone, #5 healthcheck, #11 license expiry). Son ~50 líneas totales y blindar al cliente vale el día y medio de trabajo.

### D4 — ¿Quién es el nuevo owner del proyecto?

El handoff de Fernando Rodríguez Memije fue 2026-05-12 (`HANDOFF.md`). Pero no hay nombre asignado del siguiente. Sin owner, los 11 issues nuevos pueden quedar huérfanos.

---

## Plan de acción recomendado (en orden)

### Fase A — Validación en servidor de pruebas (sandbox)

> Bajo riesgo. Hace falta acceso al servidor de pruebas + creds sandbox que ya están en `.env`.

1. **Verificar que el repo del servidor de pruebas está al día**:
   ```powershell
   cd C:\ruta\al\servidor
   git fetch origin
   git checkout main
   git pull origin main
   ```
   Debe traer hasta `b09c553` (commit del backlog).

2. **Reiniciar el servicio para que tome el código nuevo**:
   ```powershell
   Stop-Service SageSync
   Start-Service SageSync
   ```

3. **Ejecutar dry-run** (no escribe a Fracttal):
   ```powershell
   npm run sync:preview
   ```
   Esperado: salida con `caseCounts`, `preview[]`. Sin DB Sage real no procesará items; con DB Sage debería procesar lo que el query filtra.

4. **Si dry-run pasa, ejecutar sync real**:
   ```powershell
   npm run sync
   ```
   Cero impacto en prod del cliente — el sandbox de Fracttal es independiente.

5. **Verificar logs**:
   ```powershell
   Get-Content logs\sagesync.log -Tail 50
   ```

### Fase B — Resolver decisiones D1 y D2 con stakeholders

Pausa de desarrollo hasta tener respuestas. Documentar las decisiones en `docs/MEMORY.md` cuando lleguen.

### Fase C — Arreglar los 3 críticos antes de prod

Crear `/goal` nuevo: "implementar issues #3 (timezone), #5 (healthcheck) y #11 (license expiry warning) antes del primer deploy a prod del cliente".

Cada issue tiene snippet de código en la descripción — copiar/adaptar/test/commit. Total estimado: 1.5 días de trabajo.

### Fase D — Ajustar `config.json` según D1

Cuando se confirme el almacén destino:
- Editar `config.json.locationMapping.GRAL.fracttalWarehouseCode`
- Reiniciar servicio
- Verificar `/api/system/license` y `/api/sync/health` (si Fase C está hecha)

### Fase E — Primer sync coordinado en prod

Solo cuando D1, D2 y Fase C estén hechas. Seguir el playbook en `docs/FAMILY-FILTER-ROLLOUT.md` sección 2 paso por paso. **Dry-run obligatorio** antes del primer sync real.

### Fase F — Operación sostenida + atacar el resto del backlog

Cuando el cliente está sincronizando en prod, ir tomando los issues restantes en orden de severidad:
- Críticos primero (los marcados como bug)
- Después operacional (alerting, métricas, history persistence)
- Por último el grande (#2 — refactor para respetar curación)

---

## ⚠️ NO hacer

| ❌ NO hagas | Razón |
|---|---|
| `npm run sync` en prod sin antes corregir `config.json` y correr dry-run | Sobrescribirías `ALM-AMP` (shell vacío) o peor, los $43M de COZAMIN 1 |
| Cambiar `inventoryFilters.itemBracketId` o `segment1Excluded` sin entender qué deja entrar | Es lo que define qué items se sincronizan. Cambios mal hechos = sync de TODO el catálogo Sage |
| Borrar el almacén `ALM-AMP` desde Fracttal sin entender por qué existe | Ver D1. Puede ser intencional. Coordinar primero. |
| Aceptar el trade-off del issue #2 sin confirmar con el cliente | Tersoft lo aceptó pero hay que verificar con el cliente final |
| Apuntar el `.env` del servidor de pruebas a las creds prod sin saber lo que estás haciendo | Hace puente directo sandbox ↔ prod y bypassea toda la separación de ambientes |
| Hacer `git push --force` sobre `main` | El handoff dejó historia importante. Cualquier `--force` requiere coordinación con `fmemije00@gmail.com` y el equipo Tersoft |
| Cerrar issues sin que se hayan resuelto en código | Los issues son el contrato con el siguiente owner. Cerrar uno sin merge es perder contexto |

---

## Referencias rápidas

### Archivos clave (en orden de lectura sugerido)

1. `HANDOFF.md` (raíz) — entry-point general del proyecto (español)
2. `CLAUDE.md` (raíz) — instrucciones para Claude Code / contexto técnico mixed Spanish/English
3. `docs/NEXT-STEPS.md` (este archivo) — qué hacer ahora
4. `docs/FAMILY-FILTER-ROLLOUT.md` — playbook paso a paso para deploy del cambio del 2026-05-14
5. `docs/MEMORY.md` — decisiones históricas y gotchas
6. `docs/DEPLOYMENT.md` — 12-step install client
7. `RUNBOOK.md` — ops diarias
8. `ARCHITECTURE.md` — referencia técnica al código
9. `.planning/PROJECT.md`, `.planning/ROADMAP.md`, `.planning/STATE.md` — vista GSD
10. `.planning/codebase/` — mapas de código generados 2026-05-14

### Comandos útiles

```bash
# Ver estado GSD
/gsd-progress

# Tail logs del sync
tail -100 logs/sagesync.log

# Estado actual del sync via HTTP
curl http://localhost:3000/api/sync/status

# Estado de licencia
curl http://localhost:3000/api/system/license

# Tests unitarios + integration
npm test

# Dry-run de sync (no escribe)
npm run sync:preview

# Sync real
npm run sync

# Smoke test contra Fracttal sandbox
npm run test:credentials
```

### GitHub issues por prioridad

**Críticos antes de prod del cliente**:
- [#3 — Op-1 timezone](https://github.com/FReptar0/SageSync/issues/3)
- [#5 — Op-3 healthcheck](https://github.com/FReptar0/SageSync/issues/5)
- [#11 — Op-9 license expiry warning](https://github.com/FReptar0/SageSync/issues/11)

**Críticos pero diferibles**:
- [#2 — sync semantics (preserve curated data)](https://github.com/FReptar0/SageSync/issues/2)
- [#9 — Op-7 concurrency en app.js](https://github.com/FReptar0/SageSync/issues/9)

**Operación sostenida**:
- [#4 — Op-2 alerting](https://github.com/FReptar0/SageSync/issues/4)
- [#7 — Op-5 retry/backoff](https://github.com/FReptar0/SageSync/issues/7)
- [#8 — Op-6 sync timeout](https://github.com/FReptar0/SageSync/issues/8)
- [#10 — Op-8 history persistence](https://github.com/FReptar0/SageSync/issues/10)
- [#12 — Op-10 RUNBOOK docs](https://github.com/FReptar0/SageSync/issues/12)

**Mejora a futuro**:
- [#6 — Op-4 métricas exportables](https://github.com/FReptar0/SageSync/issues/6)

### Stakeholders

| Rol | Persona | Contacto | Cuándo contactar |
|---|---|---|---|
| Owner original (handoff) | Fernando Rodríguez Memije | fmemije00@gmail.com | Si hay duda sobre intención original del diseño |
| Admin prod tenant Fracttal | Sandra Pelaez | sandra.pelaez@tersoft.mx | Para D1, validar que el destino correcto es COZAMIN 1 |
| Equipo Tersoft | (consultar Sandra) | — | Para priorizar issues post-handoff |
| Cliente Capstone Gold / Cozamin | (consultar Tersoft) | — | Para D2 (manejo de las 787 requisiciones) |

### Cosas a NO pushear (.gitignore confirmado)

- `.env` — secretos
- `.fracttal-token` — token OAuth persistido
- `logs/` — logs Winston
- `dist/` — build obfuscado (vive en `SageSync-dist`)
- `backups/` — snapshots de config.json

---

## Si te pierdes

- `/gsd-progress` te dice dónde está el proyecto
- `/gsd-help` lista todos los comandos GSD
- `/help` dentro de Claude Code para comandos del CLI
- Pregunta al issue #2 para entender por qué la decisión sobre COZAMIN 1 está pendiente
- Lee `HANDOFF.md` sección 1 para el contexto original del proyecto

---

*Generado durante la sesión Claude Code del 2026-05-14, posterior al deploy de family-filter sync y validación contra tenant prod 779 (Capstone Gold / Cozamin). Si encuentras errores o información desactualizada en este doc, actualízalo en el mismo PR donde resuelvas la cosa.*
