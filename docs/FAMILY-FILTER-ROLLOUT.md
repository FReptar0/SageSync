# Family-Filter Sync — Sandbox & Producción

**Fecha:** 2026-05-14
**Alcance:** Activar el sync filtrado por familia de productos (`ITEMBRKID='FSA'` + exclusión de 16 segmentos) y migrar el primer cliente a producción **sin sobreescribir items ya cargados manualmente** en el almacén Fracttal.

---

## 0. Resumen ejecutivo

Cambios en código:

| Componente | Cambio |
|---|---|
| `config.json` | Nueva sección `inventoryFilters` con `itemBracketId` y `segment1Excluded` |
| `src/config/configManager.js` | `getInventoryFilters()` — valida y devuelve la config (con defaults seguros) |
| `src/services/sageService.js` | Query reconstruida dinámicamente, **`I.FMTITEMNO` como `ItemNumber`**, filtros aplicados solo en el path de sync. Dashboard sigue browseando inventario completo. Parámetros SQL nominados para prevenir injection. |
| `src/app.js` | `syncInventory({ dryRun: true })` — clasifica items en Case A/B/C **sin escribir** a Fracttal |
| `src/sync.js` | `--dry-run` CLI flag |
| `src/controllers/syncController.js` + routes | `POST /api/sync/preview` |
| `package.json` | `npm run sync:preview` |
| Tests | 102/102 verde — 39 nuevos sobre estos cambios |

Riesgo crítico: el almacén Fracttal de prod **ya tiene items cargados manualmente**. Un sync sin precaución llamaría `adjustInventoryStock` (Case A) y sobreescribiría sus stocks con los valores de Sage300. Por eso el **dry-run es obligatorio** antes del primer sync real.

---

## 1. Sandbox: prueba de aceptación local (sin tocar prod)

### 1.1 Pre-requisitos
- Credenciales sandbox de Fracttal en `.env` (`FRACTTAL_CLIENT_ID`, `FRACTTAL_CLIENT_SECRET`, `FRACTTAL_BASE_URL=https://app.fracttal.com/api`, `FRACTTAL_OAUTH_URL=https://one.fracttal.com/oauth/token` apuntando al tenant sandbox).
- License server registrando una `SAGESYNC_API_KEY` válida (el license gate corre antes de cualquier sync).
- Acceso de lectura a Sage300 MSSQL del cliente (es la única forma de obtener data real). Si no hay acceso directo, ver §1.5 — fixture local.
- Branch limpio: `git status` sin cambios sin commitear.

### 1.2 Ejecutar la suite de tests local

```bash
npm test
```

Debe imprimir: `Test Suites: 8 passed, 8 total`. Tests específicos a observar:
- `tests/services/sageService.test.js` — el query usa `FMTITEMNO` y los filtros se aplican condicionalmente.
- `tests/config/configManager.test.js` — los filtros default son seguros.
- `tests/integration/syncInventoryDryRun.test.js` — **cero llamadas a métodos de escritura** en dry-run.

### 1.3 Configurar `config.json` con la familia y exclusiones reales

Verificar que la sección `inventoryFilters` quedó con los valores requeridos:

```json
"inventoryFilters": {
  "itemBracketId": "FSA",
  "segment1Excluded": [
    "001", "002", "004", "005", "006",
    "018", "019", "035", "048", "049",
    "052", "053", "060", "104", "106",
    "107"
  ]
}
```

Si el cliente tiene una lista distinta, **ajustar ese bloque** antes de continuar. Snapshot del archivo:

```bash
npm run maintenance:backup
```

(El snapshot queda en `backups/config-<timestamp>.json`.)

### 1.4 Dry-run contra el sandbox de Fracttal

```bash
npm run sync:preview
```

Esto:
1. Valida env vars y license.
2. Conecta a Sage300 y ejecuta el query filtrado.
3. Consulta el almacén Fracttal de sandbox (sólo GET — nunca crea).
4. Para cada item, llama `GET /items/{code}` para clasificarlo.
5. Imprime un resumen y los primeros 5 items del preview a stdout.
6. **NO llama a ningún endpoint de escritura.**

Salida esperada (extracto):

```
=== DRY-RUN PREVIEW ===
{
  "totalItems": 1234,
  "processedItems": 1234,
  "errors": 0,
  "caseCounts": { "caseA": 50, "caseB": 12, "caseC": 1172 },
  "warehousesMissing": [],
  "firstItems": [
    {
      "itemCode": "AB-001",
      "fracttalWarehouse": "TEST001",
      "case": "C",
      "currentStockInWarehouse": null,
      "plannedStock": 25,
      "plannedUnitCost": 100,
      "plannedMin": 5,
      "plannedMax": 15
    },
    ...
  ]
}
(1234 items en el preview completo, mostrando primeros 5)
```

Validar:
- `totalItems` baja respecto a un `getAllInventoryItems` sin filtros (confirma que `ITEMBRKID='FSA'` + exclusión están filtrando).
- `caseCounts.caseC` debe ser ≈ `totalItems` en el primer dry-run sobre sandbox vacío.
- `errors = 0`.
- `warehousesMissing` vacío si el almacén ya existe; con un nombre si va a crearse.

### 1.5 Validar sin acceso a Sage300 (fixture local)

Si no tienes acceso directo a la BD del cliente todavía, puedes validar el flujo end-to-end con `npm test`. Los tests de integración (`tests/integration/syncInventoryDryRun.test.js`) mockean Sage y Fracttal y cubren:
- Cero escrituras en dry-run.
- Clasificación correcta Case A/B/C.
- Resumen y `caseCounts` consistentes.
- Comportamiento ante 404 de almacén.
- Conteo de errores por item.

Esto da confianza estructural sin tocar bases reales.

### 1.6 Sync real contra el sandbox

Una vez que el dry-run se vea sano:

```bash
npm run sync
```

Esto ejecuta el flujo completo: lee Sage, valida licencia, crea/asocia/ajusta en el sandbox de Fracttal.

Verificar:
- `logs/sagesync.log` muestra el resumen.
- Dashboard `http://localhost:3000` (o donde corra) muestra el último sync exitoso.
- Vía Fracttal sandbox UI: los items del filtro aparecen en el almacén.

### 1.7 Limpiar sandbox antes de mover a prod

Si el sandbox quedó "sucio" con items de prueba que podrían afectar la siguiente prueba:

- **No borrar el almacén** — usar el dashboard de Fracttal sandbox para borrar items específicos.
- O usar un código de almacén dedicado en `config.json` para pruebas (ej: `TEST001`) — los items quedan aislados.

---

## 2. Producción: migración del primer cliente con almacén pre-poblado

> **Regla #1:** No corras `npm run sync` antes del dry-run. El almacén tiene items manuales — un sync directo los re-escribiría con los valores de Sage300.

### 2.1 Pre-flight (ANTES de tocar el servidor del cliente)

- [ ] Tag `v1.1` ya pusheado (`git tag --list | grep v1.1` → `v1.1`).
- [ ] Branch con estos cambios (config + sageService + dryRun) mergeado a `main` y subido al obfuscation pipeline (CI: `.github/workflows/obfuscate-deploy.yml`).
- [ ] `SAGESYNC_API_KEY` para este cliente está registrada en el license server (`sageconnect-license.vercel.app`).
- [ ] Conoces el **código del almacén Fracttal de prod** del cliente y está reflejado en `config.json.locationMapping.GRAL.fracttalWarehouseCode`. (Si dudas, antes de cualquier dry-run lánzame esa info para confirmar.)
- [ ] Tienes acceso vía RDP/SSH al servidor Windows del cliente.
- [ ] `package.json` versión bumpea si quieres trazabilidad (`npm version patch` opcional).

### 2.2 Backup defensivo en el servidor del cliente

En el servidor:

```powershell
# 1. Detener el servicio para que la BD/token estén "tranquilos" durante backups
Stop-Service SageSync 2>$null

# 2. Backup de config.json
copy config.json config.json.bak-pre-family-filter-2026-05-14
npm run maintenance:backup   # también deja una copia en backups/

# 3. Backup del token (para rollback rápido si algo se va mal)
copy .fracttal-token .fracttal-token.bak-pre-family-filter-2026-05-14

# 4. Snapshot de logs actuales (referencia "antes")
copy logs\sagesync.log logs\sagesync-pre-family-filter-2026-05-14.log
```

### 2.3 Desplegar el código nuevo

Desde el repo obfuscado (`SageSync-dist`) o copia manual:

```powershell
# Detener el servicio (si seguía corriendo)
Stop-Service SageSync

# Actualizar el dist instalado — SIEMPRE git reset --hard, NUNCA git pull
# (el repo SageSync-dist tiene archivos ofuscados; pull genera conflictos irrecuperables)
cd E:\SageSync   # o donde esté instalado
git fetch origin
git reset --hard origin/main
npm install --production

# Verificar config.json (especialmente inventoryFilters y locationMapping.GRAL)
notepad config.json
```

**Validación crítica de config.json en prod:**
- `inventoryFilters.itemBracketId` = `"FSA"` (o el bracket real del cliente).
- `inventoryFilters.segment1Excluded` con los 16 segmentos correctos.
- `locationMapping.GRAL.fracttalWarehouseCode` apunta al código del almacén EXISTENTE (no a uno nuevo).

### 2.4 Dry-run en prod (cero escrituras, sólo lectura)

```powershell
npm run sync:preview
```

Esto **debe** producir cero escrituras. Confirmar revisando `logs/sagesync.log`:
- Buscar líneas `[DRY-RUN]` — son las acciones que se ejecutarían en modo real.
- `Case A` = items que YA están en el almacén → su stock sería sobreescrito. **Cada Case A es un item con stock manual que perdería su valor.**
- `Case B` = item existe pero no en este almacén → se asociaría (no destruye nada).
- `Case C` = item completamente nuevo → se crearía (no destruye nada).

Validación crítica:
- `caseA == 0` → ningún item de Sage choca con los items manuales. Sigue al §2.5 sin preocupaciones.
- `caseA > 0` → **hay choque**. Revisa el preview item por item. Para cada uno con `caseA`, `currentStockInWarehouse` te dice qué valor manual perderías. Decide:
  1. **Aceptar el sobreescrito** porque Sage300 es la fuente de verdad nueva → sigue al §2.5.
  2. **Excluir esos items** del sync → agrega su `SEGMENT1` (u otro filtro) a `inventoryFilters.segment1Excluded` en `config.json`, repite el dry-run, vuelve a este check.
  3. **Posponer** y revisar con el cliente.

Guardar el output del dry-run:

```powershell
npm run sync:preview > logs\dryrun-prod-2026-05-14.log 2>&1
```

### 2.5 Punto de aprobación

Antes del primer sync real:

- [ ] Cliente firma off en el reporte del dry-run (resumen + preview).
- [ ] `caseA` aceptado o llevado a cero vía exclusiones.
- [ ] `warehousesMissing` está vacío (no se va a crear ningún almacén nuevo en prod en este primer pase).
- [ ] `errors == 0` o conoces el motivo de cada error.

### 2.6 Primer sync real

```powershell
# Sync manual one-shot, verificar resultado, después decidir si arrancamos el servicio.
npm run sync
```

Verificar:
- Exit code 0.
- `logs/sagesync.log` muestra el resumen con `dryRun: false` y los conteos esperados.
- Vía Fracttal UI: spot-check de 5 items aleatorios — sus stocks coinciden con Sage300.
- Vía Fracttal UI: spot-check de items que NO matchean el filtro (otro bracket) — su stock NO cambió.

### 2.7 Reactivar el servicio en cron

```powershell
Start-Service SageSync
Get-Service SageSync   # debe verse Running
```

Validar:
- Dashboard `http://localhost:3000/api/system/license` → `state: VALID`.
- Dashboard `http://localhost:3000/api/sync/status` → último sync exitoso.
- `logs/sagesync.log` — el cron correrá según `SYNC_CRON_SCHEDULE` (default 02:00 daily).

### 2.8 Monitoreo post-rollout (primer 48h)

- Revisar `logs/sagesync.log` el día siguiente: el cron debe haber corrido y reportado un resumen normal.
- Revisar `logs/error.log`: cero entradas nuevas idealmente; si las hay, triage inmediato.
- Tener a mano el dashboard y `/license-status` (slash command de Claude Code) por si hay cualquier degradación.

---

## 3. Rollback rápido (si algo se va mal)

```powershell
# 1. Detener el servicio
Stop-Service SageSync

# 2. Revertir config.json
copy config.json.bak-pre-family-filter-2026-05-14 config.json

# 3. Si los stocks se sobreescribieron y necesitas restaurarlos:
#    No hay rollback automático — Fracttal no tiene historial de adjustInventoryStock.
#    Acción: pedir al cliente que reingrese los stocks manuales en Fracttal,
#    o usar el dump del dry-run (sección 2.4) que dejó constancia de los valores
#    previos en preview.currentStockInWarehouse.

# 4. Si quieres regresar al código viejo (sin family filter):
#    git fetch origin && git reset --hard v1.1 sobre el repo del cliente.
#    (NUNCA git checkout / git pull en el dist ofuscado — siempre reset --hard al ref deseado)

# 5. Reiniciar el servicio
Start-Service SageSync
```

Por eso el dry-run + preservación del JSON en `logs/dryrun-prod-2026-05-14.log` es el seguro: ahí queda registrado cada `currentStockInWarehouse` antes del cambio.

---

## 4. Checklist operativo (versión imprimible)

```
☐ Tests locales verdes (npm test → 102/102)
☐ config.json revisado: inventoryFilters + locationMapping.GRAL → almacén real prod
☐ SAGESYNC_API_KEY del cliente registrada en license server
☐ Backups: config.json.bak, .fracttal-token.bak, sagesync.log snapshot
☐ Dry-run en prod: npm run sync:preview > logs/dryrun-prod-{fecha}.log
☐ caseA revisado item por item; decisión documentada
☐ warehousesMissing vacío
☐ errors == 0
☐ Aprobación del cliente sobre el reporte del dry-run
☐ Primer sync real: npm run sync — exit 0
☐ Spot-check 5 items en Fracttal UI: stocks coinciden con Sage
☐ Spot-check 5 items fuera del filtro: stocks NO cambiaron
☐ Start-Service SageSync; servicio Running
☐ /api/system/license → VALID
☐ /api/sync/status → último sync exitoso
☐ 48h de monitoreo: log diario sin errores nuevos
```

---

## 5. Preguntas frecuentes

**¿Por qué `FMTITEMNO` y no `ITEMNO`?**
`I.FMTITEMNO` es el código formateado del item en Sage300 (con separadores que el usuario ve). Si el almacén Fracttal de prod tiene items cargados manualmente, los códigos manuales probablemente usen el formato visible — que matchea `FMTITEMNO`. El raw `ITEMNO` puede tener un formato distinto y producir miles de Case C falsos.

**¿Qué pasa con el item `item1` del test que estaba diferido?**
Resuelto en este mismo paquete: el test ahora valida que `updateWarehouseItem` (deprecated) llama el endpoint correcto `/inventories_adjustment/{code}`. Cero impacto en código de prod — sólo cierra el ítem de la lista de v1.1 diferidos.

**¿El dashboard del operador muestra el inventario filtrado?**
No. El sync filtra (path `getAllInventoryItems`), pero el dashboard usa `getInventoryItemsByLocation` / `getInventoryItemByCode` que NO aplican `inventoryFilters`. El operador sigue viendo todo el inventario de Sage para fines de debugging. Esto fue una decisión explícita.

**¿Y si el cliente cambia el bracket o las exclusiones?**
Cambiar `config.json` (sección `inventoryFilters`) y reiniciar el servicio. No requiere despliegue de código.

**¿El SQL es seguro contra injection?**
Sí. Tests `tests/services/sageService.test.js` (`does NOT use literal string interpolation for SEGMENT1 values`) verifican que TODOS los valores se pasan como parámetros mssql nominados (`@seg1Excl0, @seg1Excl1, ...`), no como string literal — incluso si alguien intentara meter `'; DROP TABLE--` en `config.json`, llegaría como parámetro escapado por el driver.

**¿Y si el almacén de prod no existe todavía?**
El dry-run lo reportará en `warehousesMissing`. En modo real, `ensureWarehouseExists` lo crearía automáticamente. Pero en el caso de este cliente, el almacén YA existe — `warehousesMissing` debe estar vacío. Si no lo está, revisa `config.json.locationMapping.GRAL.fracttalWarehouseCode`.

---

*Documento generado: 2026-05-14 junto con el cambio de family-filter sync.*
