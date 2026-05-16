# Playbook de validación en servidor de prueba — Continuación

**Última actualización:** 2026-05-15
**Servidor de prueba:** ZCL-RDS-TEST (ruta: `E:\SageSync-dist`)
**Contexto:** Esta sesión completó steps 0-5 del playbook de validación. Faltan **steps 6-9** y se documentan aquí para que el siguiente owner los ejecute.

> **Antes de empezar:** lee `docs/NEXT-STEPS.md` (estado general del proyecto) y `docs/FAMILY-FILTER-ROLLOUT.md` (rollout sandbox→prod). Este playbook es solo la parte de validación en servidor de prueba.

---

## Estado actual — qué ya está validado (NO repetir)

### Steps completados el 2026-05-15

| # | Comando | Resultado | Notas |
|---|---|---|---|
| 0 | `git fetch && git reset --hard origin/main` + `npm install` | ✅ | Servidor al día con commit `ca66d69` o posterior |
| 1 | `npm test` | ⚠ 103/110 | Las 7 fallas son `tests/integration/fracttal.integration.test.js` por creds del .env del servidor (no regresión de código) |
| 2 | `npm run test:credentials` | ⚠ 401 | Devolvió INVALID_CREDENTIALS pero `test:workflow` (que usa mismas creds + token cache) sí funciona. Probable: el script de test:credentials hace auth fresh sin usar el token cache. No bloquea steps 3+ |
| 3 | `npm run test:workflow` | ✅ 9/9 | `Listo para produccion: SI` después de borrar TEST001 viejo y dejar que se recree con `external_integration:false` |
| 4 | `npm run inspect:warehouses` | ✅ | 1 almacén en sandbox (TEST001), no-integrado |
| 5 | `npm run sync:preview` (real Sage300 + Fracttal sandbox) | ✅ | 9,114 items query / 9,112 procesados / 1 error transient (issue #14) / Case B: 2,791 / Case C: 6,321 / itemCodes en formato FMTITEMNO ✅ |

### Steps pendientes (este doc)

| # | Comando | Tiempo aproximado |
|---|---|---|
| 6 | `npm run sync` (real al sandbox) | **3-4 horas** |
| 7 | Server up + endpoints HTTP | 15 min |
| 8 | Verificación visual Fracttal sandbox UI | 20 min (manual + screenshots) |
| 9 | Empaquetar evidencia para cliente | 5 min |

---

## Gotchas críticos — léelos antes de continuar

### 1. Renovar token ANTES de syncs largos

Issue [#14](https://github.com/FReptar0/SageSync/issues/14) — si el token OAuth expira mid-sync, ~1 item falla con `INVALID_TOKEN`. El cliente self-heals pero el item de la ventana de race se pierde (lo recoge el siguiente sync). Para syncs largos:

```bash
npm run maintenance:token
```

Esto fuerza renovación, dejando ~6h de validez fresca al nuevo token. Hazlo antes de cualquier `npm run sync` (que tarda 3-4h).

### 2. `NODE_ENV=production` silencia stdout

`src/config/logger.js:40-47` — el logger solo agrega Console transport cuando NO es production. El `.env` del servidor tiene `NODE_ENV=production` (correcto para deploy normal), pero para ver progreso en interactivo:

```bash
NODE_ENV=development npm run sync
```

O monitorea desde otra terminal:

```bash
tail -f logs/sagesync.log | grep -E "Progreso|Error|exitosamente"
```

### 3. El sync es serial sin concurrencia

`src/app.js` procesa items uno por uno, ~700ms cada uno (warehouse check + item check + writes). Para 9,114 items: ~3-4 horas. No es bug, es arquitectura. Issue [#8](https://github.com/FReptar0/SageSync/issues/8) cubre el refactor a Promise.all en chunks.

### 4. ALM-AMP debe quedarse con `external_integration:false`

Issue [#13](https://github.com/FReptar0/SageSync/issues/13) — almacenes con `external_integration:true` bloquean `PUT /inventories_adjustment/`. ALM-AMP **no existe** en sandbox al momento de este doc; el primer `npm run sync` lo creará con `external_integration:false` (per `config.json:54-62` ya parchado).

Después del primer sync, verifica:

```bash
npm run inspect:warehouse -- ALM-AMP
# Esperado: external_integration: false ✅
```

Si por alguna razón quedara `true`, hay que borrarlo en Fracttal UI y re-correr el sync (mismo procedimiento que con TEST001 antes).

### 5. Cancelar procesos pendientes

Si dejaste un `sync:preview` corriendo en background, cancelarlo antes del sync real:

```bash
# Ver procesos node activos
ps -W | grep node

# Si hay alguno, Ctrl+C en su terminal o kill por PID
# (En Git Bash Windows: Ctrl+C en la terminal donde corre)
```

### 6. NO uses `git pull` — siempre `git reset --hard`

El repo `SageSync-dist` está obfuscado. `git pull` genera conflictos irrecuperables. Siempre:

```bash
git fetch && git reset --hard origin/main
```

---

## Step 6 — Sync real al sandbox

```bash
cd /e/SageSync-dist

# 6.1 — Renovar token (mitigación de issue #14)
npm run maintenance:token

# 6.2 — Verificar token nuevo (debe expirar ~6h adelante)
cat .fracttal-token

# 6.3 — Cancelar cualquier sync pendiente
# Ctrl+C en la terminal del sync:preview si está corriendo
ps -W | grep node   # confirmar que solo queda el shell

# 6.4 — Sync real con stdout visible
ts=$(date +%Y-%m-%d_%H%M)
NODE_ENV=development npm run sync 2>&1 | tee "logs/sync-$ts.log"
echo "Exit code: $?"
```

**Duración:** 3-4 horas. Puedes dejarlo corriendo y volver.

**Monitoreo desde otra terminal (opcional):**

```bash
# Conteo y progreso
watch -n 30 'grep -c "Case [ABC]" logs/sagesync.log; tail -1 logs/sagesync.log | grep -o "Progreso: [0-9]*/[0-9]*"'

# O simple tail
tail -f logs/sagesync.log | grep -E "Progreso|Error|exitosamente|completado"
```

### Resumen esperado al final

```
RESUMEN DE SINCRONIZACIÓN:
- Total items en Sage300 (tras filtros): 9114
- Items procesados: 9112-9114
- Case A: 0 (primer sync)
- Case B: ~2791
- Case C: ~6321
- Errores: 0-2 (0 ideal; 1-2 tolerable por issue #14)
- Almacenes verificados/creados: ALM-AMP

SINCRONIZACIÓN COMPLETADA EXITOSAMENTE
```

**Verificar:**
- Exit code = 0
- `Errores: 0` o ≤ 2
- `Almacenes verificados/creados` incluye `ALM-AMP`
- ALM-AMP ahora existe en sandbox con `external_integration:false` (corre `npm run inspect:warehouse -- ALM-AMP`)

### Si el sync falla a la mitad

1. Revisar últimas 200 líneas de `logs/sagesync.log` y `logs/error.log`
2. Si es **token expiry**: `npm run maintenance:token` y re-correr (los items ya creados pasarán a Case A/B en el segundo sync, idempotente)
3. Si es **Sage SQL error**: verificar conectividad MSSQL al servidor de Sage300, revisar `DB_*` en `.env`
4. Si es **Fracttal 5xx transient**: re-correr (idempotente)
5. Si es **algo más**: reportar al equipo con logs completos + abrir issue `[Test-Server]` en GitHub

---

## Step 7 — Server up + endpoints HTTP

Levanta el server completo (Express + cron + dashboard) en una terminal:

```bash
NODE_ENV=development npm start
```

Espera a ver `Server listening on port 3000` o similar.

En **otra terminal**, valida endpoints:

```bash
# Estado de licencia
curl -s http://localhost:3000/api/system/license | python -m json.tool

# Estado del último sync
curl -s http://localhost:3000/api/sync/status | python -m json.tool

# Historial (in-memory, se pierde al reiniciar — issue #10)
curl -s http://localhost:3000/api/sync/history | python -m json.tool

# Disparar dry-run via HTTP
curl -s -X POST http://localhost:3000/api/sync/preview | python -m json.tool
```

Si Python no está, usar `jq`:

```bash
curl -s http://localhost:3000/api/system/license | jq .
```

O simplemente sin formato:

```bash
curl -s http://localhost:3000/api/system/license
```

**En navegador local del servidor:**
- Dashboard: http://localhost:3000

Cuando termines: **Ctrl+C** en la terminal del server.

---

## Step 8 — Verificación visual Fracttal sandbox UI

**Para el cliente** — screenshots como evidencia visual.

1. Abre https://app.fracttal.com en tu navegador
2. Si estás en sesión prod del cliente: **logout** (avatar → cerrar sesión)
3. **Login con credenciales sandbox** (mismas que están en `FRACTTAL_CLIENT_ID/SECRET` del .env del test server, pero login UI usa email/password — pídelas si no las tienes)
4. Menu lateral → **Almacenes** (Warehouses)
5. Busca **ALM-AMP** en la lista
6. Click en ALM-AMP → tab **Existencia** (Inventory)
7. Verifica que aparezcan los ~9,000 items con stock
8. Click en 1-2 items para ver detalle (descripción, costo, min/max)

**Captura screenshots:**

| Pantalla | Para mostrar |
|---|---|
| Lista de almacenes con ALM-AMP visible | Almacén creado |
| Tab Existencia de ALM-AMP con items y conteo | Items sincronizados |
| Detalle de 1 item específico (ej. `003-010-004`) | Datos correctos: stock, costo, descripción |

Guarda los screenshots en una carpeta para incluirlos en step 9.

---

## Step 9 — Empaquetar evidencia para cliente

```bash
ts=$(date +%Y-%m-%d_%H%M)
mkdir -p "evidence-$ts"

# Logs y outputs
cp logs/test-workflow-*.json "evidence-$ts/" 2>/dev/null || true
cp logs/sync-*.log "evidence-$ts/" 2>/dev/null || true
cp logs/dryrun-*.log "evidence-$ts/" 2>/dev/null || true
cp logs/sagesync.log "evidence-$ts/sagesync-snapshot.log"
cp logs/error.log "evidence-$ts/error-snapshot.log" 2>/dev/null || true

# Config usada (sin .env por seguridad)
cp config.json "evidence-$ts/config-used.json"

# Screenshots de step 8 (ajusta path según donde los guardaste)
cp ~/Pictures/sandbox-*.png "evidence-$ts/" 2>/dev/null || true
cp /e/screenshots/*.png "evidence-$ts/" 2>/dev/null || true

# Snapshots HTTP (server debe estar corriendo en :3000 — opcional)
curl -s http://localhost:3000/api/sync/history > "evidence-$ts/sync-history.json" 2>/dev/null || true
curl -s http://localhost:3000/api/system/license > "evidence-$ts/license-status.json" 2>/dev/null || true

# Resumen del query Sage (cuántos items, breakdown por caso)
grep -E "Se obtuvieron|Case [ABC] \(|Errores:|Almacenes" logs/sagesync.log | tail -20 > "evidence-$ts/summary.txt"

# Comprimir
# En Git Bash Windows usa zip si lo tienes; alternativa: PowerShell Compress-Archive
zip -r "evidence-$ts.zip" "evidence-$ts" 2>/dev/null \
  || powershell -Command "Compress-Archive -Path '$ts' -DestinationPath 'evidence-$ts.zip'"

ls -lh "evidence-$ts.zip"
echo "Listo para enviar al cliente: evidence-$ts.zip"
```

---

## Cleanup post-validación

```bash
# Detener el servicio (si quieres parar el cron diario)
Stop-Service SageSync

# O dejarlo corriendo (cron seguirá en su horario configurado)
Start-Service SageSync
```

Para confirmar el estado del servicio:

```powershell
Get-Service SageSync
```

---

## Si encuentras algo no-bloqueante

Cualquier comportamiento raro o output inesperado que NO impida continuar:

1. Captura el output completo del comando
2. Captura últimas 200 líneas de `logs/sagesync.log` y `logs/error.log`
3. Abrir issue en GitHub con título `[Test-Server] <descripción corta>` y label `bug` o `question`
4. Si tiene workaround, documentarlo en el mismo issue

## Si encuentras algo bloqueante

Si algo impide continuar (sync no termina, server no levanta, dashboard 500, etc.):

1. **Para inmediatamente** (Ctrl+C en cualquier proceso activo)
2. Capturar logs completos
3. Reportar a Fernando Rodríguez Memije (`fmemije00@gmail.com`) o al equipo Tersoft con:
   - Comando que falló
   - Output completo
   - Últimas 200 líneas de logs
4. NO ejecutes `npm run sync` contra prod del cliente hasta resolver

---

## Issues conocidos no-bloqueantes (referencia rápida)

| Issue | Severidad | Mitigación |
|---|---|---|
| [#13 — adjustInventoryStock en almacenes integrados](https://github.com/FReptar0/SageSync/issues/13) | CRITICAL | Bloquea prod (COZAMIN 1). NO afecta sandbox |
| [#14 — Token rotation race](https://github.com/FReptar0/SageSync/issues/14) | Baja | `npm run maintenance:token` antes de syncs largos |
| [#2-#12 — Operational hardening](https://github.com/FReptar0/SageSync/issues) | Variada | Backlog 999.1, no urgente para validación |

---

## NO HACER en este servidor

| ❌ NO hagas | Razón |
|---|---|
| Cambiar `.env` apuntando a prod (`FRACTTAL_BASE_URL` o `FRACTTAL_OAUTH_URL`) | Hace puente sandbox→prod, peligroso |
| Cambiar `config.json.warehouseCreationSettings.defaultValues.external_integration` a `true` | Mitigación temporal de issue #13 — no revertir |
| Borrar `.fracttal-token` durante un sync activo | Causa errors transient |
| Ejecutar `git pull` | El repo está obfuscado, pull genera conflictos. Usar `git reset --hard origin/main` |
| `npm run sync` contra prod sin resolver issue #13 primero | Items se crearán con stock=0 y syncs siguientes fallarán silenciosamente en COZAMIN 1 |
| Borrar logs durante validación | Son la evidencia para el cliente (step 9) |
| Cambiar `inventoryFilters` en `config.json` | Es lo que define qué items entran al sync; cambios mal hechos = catálogo entero o nada |

---

## Contactos

| Rol | Persona | Cuándo |
|---|---|---|
| Owner original | Fernando Rodríguez Memije (`fmemije00@gmail.com`) | Dudas de diseño/arquitectura |
| Admin tenant prod Fracttal | Sandra Pelaez (`sandra.pelaez@tersoft.mx`) | Creds, config de prod |
| Equipo Tersoft | Vía Sandra | Coordinación operativa |
| Cliente Capstone Gold / Cozamin | Vía Tersoft | Decisiones D2/D5 (ver NEXT-STEPS.md) |

---

*Generado durante la sesión 2026-05-15. Validación parcial completada (steps 0-5). Siguiente owner ejecuta steps 6-9 siguiendo este doc.*
