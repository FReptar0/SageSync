# Runbook — Prueba de la carga DIARIA/delta a Fracttal

Guía para validar en el **servidor de test** que la sincronización delta sube
**solo lo que se movió**. Rama: `feat/fracttal-carga-diaria-delta`.

## Contexto en 3 líneas
- La carga **inicial** (`npm run sync`) sube **todos** los artículos. Ya se corrió hace meses (~9,114).
- La carga **diaria/delta** (`npm run sync:moved`) sube **solo lo que se movió**, con el query de Santiago (detecta movimiento vía `ICIVAL.AUDTDATE`).
- El delta **depende del cierre de fin de día** de Sage: sin ese cierre, no hay movimientos que detectar.

## Prerrequisitos
| Para | Necesitas |
|---|---|
| **Nivel 0** (query sola) | acceso a **SSMS** contra el Sage de test |
| **Niveles 1-2** (sync) | `npm install` hecho + `.env` apuntando a **test** + licencia válida + **Fracttal de test** disponible |

---

## Nivel 0 — La query en SSMS (esto lo puedes hacer tú solo)

Pega esto en SSMS contra el Sage de **test**:

```sql
DECLARE @fechaCorte int = CONVERT(int, CONVERT(char(8), GETDATE(), 112)); -- HOY (YYYYMMDD)

-- BLOQUE A — CONTEO de lo movido (compara ANTES vs DESPUÉS del cierre)
SELECT COUNT(*) AS ItemsMovidos
FROM (
    SELECT I.FMTITEMNO
    FROM COPDAT.dbo.ICILOC AS B
    JOIN COPDAT.dbo.ICITEM AS I ON B.ITEMNO = I.ITEMNO
    JOIN COPDAT.dbo.ICIVAL AS V ON V.ITEMNO = I.ITEMNO
    WHERE I.INACTIVE = 0 AND I.STOCKITEM = 1 AND B.LOCATION = 'GRAL'
      AND I.ITEMBRKID = 'FSA'
      AND I.SEGMENT1 NOT IN ('001','002','004','005','006','018','019','035',
                             '048','049','052','053','060','104','106','107')
    GROUP BY I.FMTITEMNO, B.LOCATION
    HAVING MAX(V.AUDTDATE) >= @fechaCorte
) t;

-- BLOQUE B — DETALLE (lo que SageSync mandaría a Fracttal)
SELECT
    I.FMTITEMNO AS ItemNumber, I.[DESC] AS Description, B.LOCATION AS Location,
    B.QTYONHAND AS QuantityOnHand, B.QTYMINREQ AS MinimumStock,
    B.STDCOST AS StandardCost, B.RECENTCOST AS RecentCost, B.LASTCOST AS LastCost
FROM COPDAT.dbo.ICILOC AS B
JOIN COPDAT.dbo.ICITEM AS I ON B.ITEMNO = I.ITEMNO
JOIN COPDAT.dbo.ICIVAL AS V ON V.ITEMNO = I.ITEMNO
WHERE I.INACTIVE = 0 AND I.STOCKITEM = 1 AND B.LOCATION = 'GRAL'
  AND I.ITEMBRKID = 'FSA'
  AND I.SEGMENT1 NOT IN ('001','002','004','005','006','018','019','035',
                         '048','049','052','053','060','104','106','107')
GROUP BY I.FMTITEMNO, I.[DESC], B.LOCATION, B.QTYONHAND, B.QTYMINREQ,
         B.STDCOST, B.RECENTCOST, B.LASTCOST
HAVING MAX(V.AUDTDATE) >= @fechaCorte
ORDER BY I.FMTITEMNO, B.LOCATION;

-- BLOQUE C — FULL (contraste). El delta debe ser MUCHO menor.
SELECT COUNT(*) AS ItemsFull
FROM COPDAT.dbo.ICILOC AS B
JOIN COPDAT.dbo.ICITEM AS I ON B.ITEMNO = I.ITEMNO
WHERE I.INACTIVE = 0 AND I.STOCKITEM = 1 AND B.LOCATION = 'GRAL'
  AND I.ITEMBRKID = 'FSA'
  AND I.SEGMENT1 NOT IN ('001','002','004','005','006','018','019','035',
                         '048','049','052','053','060','104','106','107');
```

**Qué esperar:**
- **Bloque C (full):** ~9,114 → ✅ los filtros de familia funcionan.
- **Bloque A (delta):** número chico o **0**. ⚠️ **0 NO es error** — significa que nada se ha movido desde la fecha de corte (con cierre corrido).

**Prueba de que reacciona al movimiento (la clave):**
1. Corre Bloque A → anota el número.
2. Mueve **un artículo conocido** en Sage test (entrada/salida/ajuste) y corre el **cierre de fin de día**.
3. Corre Bloque A otra vez → debe **subir**; en Bloque B debe aparecer **tu artículo**.
4. ✅ Si aparece solo lo que moviste → la query funciona.

---

## ✅ La fecha (ya resuelta)
- El **código** ahora usa **HOY dinámico** (`GETDATE()` del server SQL): cada día trae solo lo movido ese día — igual que el `@fechaCorte = hoy` del query de arriba. Nivel 0 y Nivel 1 **cuadran sin cambios manuales**.
- ⚠️ **Para el cron de producción:** esto es correcto solo si el sync corre el **mismo día, después del cierre**. Si el cron corriera pasada la medianoche, se perdería lo del día anterior — en ese caso habría que usar una ventana (p.ej. `>= ayer`). Definir el horario del cron es un pendiente.

---

## Nivel 1 — Dry-run del sync (NO escribe a Fracttal)
```bash
npm run sync:moved:preview
```
- **`totalItems`** debe cuadrar con el Bloque A de SSMS.
- Revisa **`caseCounts`** (A/B/C): los que ya existen en Fracttal salen como **Case A** (solo ajuste de stock).
- No escribe nada — es seguro.

## Nivel 2 — Sync real a Fracttal test
```bash
npm run sync:moved
```
- En Fracttal test: el/los movidos **actualizaron stock**, los demás **intactos**.

---

## Qué es solo tú vs. qué necesita a otros
- ✅ **Solo tú (hoy):** Nivel 0 — si puedes correr el cierre en test. (Si no, al menos los conteos.)
- 🔴 **Necesita Fracttal test listo (Alan/Capstone):** Niveles 1-2.
- 👥 **Con Santi:** la validación end-to-end final ("control de cambios").

## Recordatorios de contexto
1. La carga inicial (9,114) fue hace meses → el delta **solo trae de la fecha de corte hacia adelante**, no rellena ese hueco. Para producción conviene una carga inicial fresca antes de encender el delta.
2. Deudas conocidas (en el código): fecha quemada, filtros de familia quemados, stock en `QTYONHAND` (on-hand) vs. disponible de la carga inicial.
