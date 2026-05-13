# Memoria histórica del proyecto SageSync

Documento curado de decisiones, descubrimientos, gotchas y contexto que el código por sí solo no explica. Pensado para que el nuevo dueño no tenga que reconstruir el "por qué" investigando commits, planning artifacts y conversaciones perdidas.

Si encuentras tú mismo algo que merezca quedar aquí, agrégalo al final. Mantén las secciones cronológicamente ordenadas dentro de cada tópico.

---

## 1. Decisiones clave de arquitectura

### 1.1 Por qué el `LicenseValidator` se portó desde `sageconnect` en vez de escribirse nuevo

`sageconnect` (proyecto hermano de Tersoft que sincroniza pagos/POS/CFDI) ya tenía un validador de licencias con 306 líneas, probado en producción, que cubría: HMAC-SHA256 + freshness + DNS bypass detection + tres-estados + 24h TTL + startup retry. Reescribirlo en SageSync hubiera sido reinventar la rueda con riesgo de bugs nuevos.

Se decidió **portarlo** y adaptarlo (no reescribirlo) con tres cambios deliberados:

1. **Logger:** `sageconnect` usaba un `LogGenerator` propio. SageSync usa el singleton de Winston. Swap directo.
2. **Estructura de config:** `sageconnect` tenía un `config.js` plano; SageSync usa `src/config/license.js` siguiendo el patrón existente de `src/config/server.js`.
3. **Email alerts:** se eliminó toda la lógica de `sendLicenseAlert` y la dependencia de `nodemailer`. El dueño anterior opted-out explícitamente: para SageSync, los warnings en logs son suficientes.

Toda la lógica de seguridad (HMAC, freshness, DNS, cache de tres estados, TTL de 24h) se mantuvo verbatim. Si necesitas auditar paridad, compara contra `sageconnect/src/services/LicenseValidator.js`.

### 1.2 Reutilización del servidor de licencias (no se hizo uno nuevo)

El servidor de licencias **`sageconnect-license.vercel.app`** ya existía y servía a SageConnect. Para SageSync se decidió reutilizarlo:

- Sólo hace falta registrar un cliente nuevo en el dashboard y obtener una `SAGESYNC_API_KEY` (UUID v4).
- `HMAC_SECRET` se comparte entre los dos proyectos.
- El servidor distingue clientes por la API key, no por nombre de producto.

Consecuencia: rotar `HMAC_SECRET` requiere coordinar **simultáneamente** todos los clientes desplegados (SageConnect + SageSync) o algunos se quedarán en `INVALID` hasta que actualicen.

### 1.3 No hay email alerts (decisión deliberada)

Pidieron específicamente: nada de avisos por correo, ni a admin ni a usuarios. Razones:

- SageSync corre on-premise en servidores de cliente; Tersoft IT no quiere recibir un correo por cada cliente que tenga un fallo de red transitorio.
- El dashboard del cliente ya muestra el estado.
- Los logs son la fuente de verdad.

Si algún día se quiere reabrir esta decisión, ojo: implicará añadir `nodemailer`, manejar SMTP credentials en `.env`, y diseñar un esquema anti-flood (no avisar 100 veces por la misma caída).

### 1.4 Dos entry points (`main.js` y `app.js`) que conviven

Históricamente:

- `app.js` era el entry point original del v1.0 — servía cron + sync, sin dashboard.
- `main.js` se añadió para servir el dashboard Express en paralelo con cron.

Cuando se hizo el v1.1 (licencias), se aplicó el license gate a **ambos** en lugar de consolidar. Razones:

- Algunos despliegues piden el modo "headless" (sin dashboard) para no exponer el puerto 3000.
- `npm run sync-only` se usa en scripts de deployment para correr el sync sin levantar nada más.

No los consolides en uno solo sin coordinar con los scripts de despliegue (`docs/DEPLOYMENT.md`, `scripts/install-service.ps1`) y los tests de integración.

### 1.5 Ofuscación con `javascript-obfuscator` + repo dist separado

Decisión de v1.0: el código fuente no se entrega al cliente. Razones:

- Protección de propiedad intelectual (Tersoft no quiere que un cliente se lleve el código y lo reuse).
- El cliente firma un contrato proprietary, pero la ofuscación es defense-in-depth.

Implementación:

- Repo `SageSync` (fuente legible, privado).
- Repo `SageSync-dist` (mismo código pero ofuscado, también privado).
- GitHub Actions corre `scripts/obfuscate.js` y force-pushea al `-dist` cada push a `src/**`, `public/**`, `package.json`, `package-lock.json`.

Opciones del ofuscador que merecen recordarse:

- `selfDefending: false` y `debugProtection: false` — facilitan troubleshooting en producción.
- `renameGlobals: false` — necesario para no romper `require/module.exports` en Node.
- `target: 'node'` — el ofuscador optimiza para runtime de Node, no de browser.

### 1.6 `requireLicense` exempta `/api/system/license` desde el wrapper, no desde el middleware

Diseño:

```js
app.use((req, res, next) => {
    if (req.path === '/api/system/license') return next();
    requireLicense(req, res, next);
});
```

Razón: el middleware `requireLicense.js` se mantiene single-responsibility (sabe sólo devolver 503 o llamar `next()`). El conocimiento de qué rutas están exentas vive donde se integra (`main.js`), no en el gate genérico. Esto hace al middleware reutilizable y trivial de testear.

### 1.7 Cron tick re-valida licencia, sync manual no lo hace

- El cron tick (`main.js`) hace `await validateLicense()` antes de correr.
- La ruta `POST /api/sync` no re-valida — confía en que `requireLicense` ya bloqueó la request si la licencia es inválida.

Diferencia importante: el cron es la única vía periódica, así que es donde mantenemos la frescura. La ruta manual va por HTTP y ya pasó por el gate.

---

## 2. Descubrimientos sobre la API de Fracttal

> Esta sección viene principalmente del session memory de febrero 2026 cuando se descubrió y arregló el bug de items huérfanos.

### 2.1 `POST /items/` crea assets huérfanos sin almacén

**Síntoma original (febrero 2026):** se reportó que items "no aparecían" en Fracttal a pesar de que los logs mostraban `Item creado exitosamente`. Investigando se descubrió que:

- `POST /items/` crea un asset standalone en Fracttal.
- El asset existe pero **no tiene asociación a ningún almacén**.
- En la UI de Fracttal, los assets sin almacén no aparecen en las vistas de inventario.
- Quedan como "huérfanos", visibles sólo si filtras por código directo.

**Implicación:** todo el v1.0 estuvo creando items así. Si miras tenants viejos de Fracttal puede haber miles de assets huérfanos sin stock visible. Limpieza manual requerida.

### 2.2 La solución correcta: `POST /inventories/` + `PUT /inventories_adjustment/`

`POST /inventories/` hace dos cosas en una llamada:

1. Crea el item.
2. Lo asocia al almacén indicado en `code_warehouse` o `id_warehouse`.

PERO **siempre inicializa stock en 0**, ignorando el campo `stock` que mandes en el body. Para setear el stock real hay que hacer un segundo call: `PUT /inventories_adjustment/{code}` con `{ code_warehouse, stock, unit_cost_stock, min_stock_level, max_stock_level }`.

Esto explica por qué la implementación actual en `src/app.js` Case C es de dos pasos:

```js
await fracttal.createInventoryWithWarehouse(createData);   // crea + asocia, stock=0
await fracttal.adjustInventoryStock(itemCode, adjustmentData); // set stock real
```

### 2.3 Tabla canónica de endpoints Fracttal (post-fix)

| Propósito | Endpoint | Método |
|-----------|----------|--------|
| Crear item + asociar a almacén (stock=0 obligatorio) | `/inventories/` | POST |
| Asociar item existente a almacén | `/inventories_associate_warehouse/` | POST |
| Ajustar stock / costo / min / max | `/inventories_adjustment/{code}` | PUT |
| Consultar item + sus almacenes | `/inventories/{code}` | GET |
| Listar todos los items+stock de un almacén | `/warehouses_items?code={warehouseCode}` | GET |
| Crear almacén | `/warehouses/` | POST |
| Consultar almacén por código | `/warehouses/{code}` | GET |
| Entrada de mercancía | `/warehouse_entries_orders/{warehouseCode}` | POST |
| Salida de mercancía | `/warehouse_outputs_orders/` | POST |

Los métodos viejos siguen en `fracttalClient.js` (e.g. `createInventoryItem`, `adjustInventory`, `updateWarehouseItem`) marcados como `DEPRECATED`. No los uses para código nuevo; eventualmente se podrán quitar pero requiere validar que ningún test los referencia.

### 2.4 Los 7 métodos nuevos que se añadieron a `FracttalClient`

Añadidos en febrero 2026:

1. `createInventoryWithWarehouse(itemData)` — `POST /inventories/`
2. `associateItemToWarehouse(code, warehouseCode, stockData)` — `POST /inventories_associate_warehouse/`
3. `adjustInventoryStock(itemCode, warehouseData)` — `PUT /inventories_adjustment/{code}`
4. `getWarehouseStock(warehouseCode, params)` — `GET /warehouses_items?code={code}`
5. `getItemInventory(itemCode)` — `GET /inventories/{code}`
6. `createWarehouseEntry(warehouseCode, entryData)` — `POST /warehouse_entries_orders/{warehouseCode}`
7. `createWarehouseExit(exitData)` — `POST /warehouse_outputs_orders/`

Los métodos 6 y 7 (entries/exits) aún no se usan en producción — sólo están disponibles para casos futuros de "registro de movimiento" que algún cliente puede llegar a pedir.

### 2.5 `UNAUTHORIZED_ENDPOINT` no es 401 normal

Fracttal usa un código de error específico `UNAUTHORIZED_ENDPOINT` (HTTP 401 con `message: "UNAUTHORIZED_ENDPOINT"` en el body) para indicar que el módulo del endpoint **no está habilitado en el tenant**. Es distinto de un token expirado.

El interceptor de respuesta de `FracttalClient` lo detecta y:

- No intenta refresh del token (sería inútil).
- Setea `error.isUnauthorizedEndpoint = true` en el error rejected.
- Sugiere contactar a soporte de Fracttal en el log.

Esto es la razón de las verificaciones explícitas en `systemController.js` para reportar el estado de cada módulo (warehouses, inventories, items) en `/api/status`.

### 2.6 Token OAuth dura ~2h pero se renueva antes de 5 minutos de expirar

Configuración del cliente:

- `expires_in` típicamente `7200` (2 horas).
- `getAccessToken()` revisa antes de cada request: si el token expira en >5min, se reutiliza; si no, llama `authenticate()` que primero intenta refresh, después client_credentials.
- Token se persiste en `.fracttal-token` con `expires_at` ISO timestamp.

El interceptor de respuesta tiene retry-once-with-fresh-token para 401 inesperados (e.g. token revocado server-side).

### 2.7 El "test workflow" canónico de 10 pasos

`tests/manual/test-workflow.js` ejecuta el flujo completo contra el almacén `TEST001` en el sandbox:

1. Autenticar
2. Verificar warehouse `TEST001` existe
3. Generar items dummy
4. Crear items con almacén (`POST /inventories/`)
5. Setear stock inicial (`PUT /inventories_adjustment/`)
6. Verificar stock en almacén (`GET /warehouses_items/`)
7. Simular cambio de stock en Sage
8. Verificar stock ajustado
9. Consultar detalles del item (`GET /inventories/{code}`)
10. Resumen

Pasaba 9/9 con 0 errores en febrero 2026. Si en el futuro este test empieza a fallar es señal de cambio en la API de Fracttal — verifica que los endpoints todavía respondan como esperamos.

---

## 3. Convenciones internas

### 3.1 Idioma del código mezclado (es/en)

No es bug, es historia:

- `app.js`, `sageService.js`, `fracttalClient.js`, `maintenance.js`, `configManager.js` — escritos originalmente en español. Variables, comentarios, logs.
- `LicenseValidator.js`, `requireLicense.js`, `validateEnv.js`, `license.js` — portados o creados en inglés (vinieron de `sageconnect` o se hicieron en el flujo de GSD que es en inglés).
- Logs: 99% en español ("Error obteniendo items...", "Almacén no encontrado", etc.).
- Tests: en inglés (Jest descriptions son `describe`/`test` en inglés).
- Planning docs (`.planning/`): en inglés (convención GSD).

**Regla práctica:** mantén el idioma del archivo donde editas. No mezcles dentro del mismo archivo.

### 3.2 Logging via Winston singleton

Usa siempre `require('../config/logger')` (ajusta el path relativo). Nunca `console.log` para producción — sólo durante desarrollo o si quieres salida explícita en la PowerShell del operador.

Niveles:

- `info` — eventos normales (autenticación exitosa, sync iniciado, item procesado).
- `warn` — situaciones recuperables (token próximo a expirar, almacén no soportado, sync skipped por lock).
- `error` — fallos reales (DB caída, 500 de Fracttal, HMAC mismatch).
- `debug` — solo si subes `LOG_LEVEL=debug` en `.env`.

Formato JSON automático por Winston (`format.json()`). El frontend parsea las líneas como JSON cuando sirve via `/api/logs`.

### 3.3 Manejo de errores en servicios

Patrón en `FracttalClient` y `SageService`:

```js
async someMethod(params) {
    try {
        // happy path
        const result = await this.client.get(...);
        return result.data;
    } catch (error) {
        logger.error('Mensaje en español:', error.response?.data || error.message);
        throw error;
    }
}
```

Importante:

- **No tragar errores.** `throw error` después de loguear.
- **No retornar `null`** en lugar de throw — rompe el contrato.
- En el loop de sync (`app.js`), el catch externo cuenta `errors++` y continúa con el siguiente item. **Esa es la única capa que tolera fallos individuales.**

### 3.4 Naming de funciones del Fracttal client

Convención (post-Feb 2026):

- `createX` — crea recurso nuevo (POST).
- `updateX` — actualiza recurso existente por código (PUT).
- `getX` — query (GET). Si retorna lista, plural (`getWarehouses`); si retorna uno, singular (`getWarehouseByCode`).
- `adjustX` — semántica específica de Fracttal (stock adjustment), prefiere este nombre antes que `updateStock`.
- `associateX` — operaciones de relación many-to-many (item ↔ warehouse).
- `ensureX` — idempotente: verifica existencia, crea si no existe.

### 3.5 `asyncHandler` en controllers

Wrapper que captura promesas rechazadas y las pasa a `next(error)`:

```js
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
```

Vive en `src/middleware/errorHandler.js`. Úsalo en todos los controllers async para que el `errorHandler` global capture las excepciones.

---

## 4. Bugs y lecciones aprendidas

### 4.1 (Resuelto, Feb 2026) Items huérfanos por usar `/items/`

Ver sección 2.1. Lección: cuando integras una API, valida no sólo que devuelva 200, sino que el resultado sea visible/usable desde la UI del producto destino. Un 200 sin observar el side effect te puede engañar durante meses.

### 4.2 (Resuelto, Abr 2026) Test crashaba Jest worker por `process.exit` en module load

Cuando se escribieron los tests de integración para el `requireLicense` middleware, el suite crasheaba con: "Jest worker exited after 4 retries".

Causa raíz: `src/routes/index.js` → `syncRoutes` → `syncController` → `require('../app')` ejecuta el top-level de `app.js`, que llama `validateEnv()`, que hace `process.exit(1)` cuando faltan env vars (que en CI no están).

Fix: `jest.mock('../../src/app', () => ({ syncInventory: jest.fn() }))` antes de los imports en el test. Ver `tests/integration/licenseEnforcement.test.js` líneas 47-50.

Lección: ten cuidado con side effects al top-level en archivos que se importan en cascada. Los tests sufren por esto.

### 4.3 (Pendiente) Test rojo de `updateWarehouseItem`

`tests/services/fracttalClient.test.js > FracttalClient > API methods > updateWarehouseItem > should update warehouse item successfully` falla porque espera PUT a `/items/item1` pero la implementación correcta llama `/inventories_adjustment/item1`.

**Es el test el que está mal, no la implementación.** Documentado en `.planning/phases/02-enforcement-surface/deferred-items.md`. Acción pendiente: actualizar el test para que espere `/inventories_adjustment/item1`.

### 4.4 (Aprendizaje) `axios.create()` corre al module load — tests necesitan `jest.mock` con factory

En `LicenseValidator.js`:

```js
const licenseClient = axios.create({ timeout: HTTP_TIMEOUT_MS, ... });
```

Esto se ejecuta cuando se importa el módulo, no cuando llamas `validate()`. Por lo tanto, no puedes hacer:

```js
beforeEach(() => {
    axios.create = jest.fn(() => mockClient); // demasiado tarde
});
```

Tienes que usar `jest.mock` con factory antes de requerir el módulo:

```js
jest.mock('axios', () => ({
    create: jest.fn(() => mockAxiosClient),
}));
const { validate } = require('../../src/services/LicenseValidator');
```

Documentado en `tests/services/LicenseValidator.test.js` y en `.planning/STATE.md`.

---

## 5. Credenciales y accesos sensibles

> **NUNCA pongas credenciales reales en este documento.** Solo referencias a dónde están.

- **Sandbox Fracttal:** existen credenciales de sandbox para pruebas (`https://app.fracttal.com/signin`). El dueño anterior las guardaba en su password manager personal. Para acceso, contactar a `fmemije00@gmail.com` o al admin de Tersoft. El usuario sandbox era de `capstonecopper.com` (cliente real prestando su tenant para pruebas).
- **`HMAC_SECRET`:** vive en Vercel env vars del proyecto `sageconnect-license`. Solo el admin de Tersoft tiene acceso al dashboard de Vercel.
- **Llaves de licencia de clientes en producción (`SAGESYNC_API_KEY`):** en el dashboard del license server. Cada cliente tiene la suya, copiada en su `.env` al desplegar. No hay almacén centralizado de "todas las llaves activas".
- **Credenciales Fracttal OAuth de clientes:** las solicita el cliente directamente a soporte de Fracttal y se las da al técnico de despliegue. SageSync no las guarda en otro lugar más que el `.env` del servidor del cliente.
- **Credenciales SQL Server de clientes:** las da el DBA del cliente. Idealmente usuario de solo-lectura.

---

## 6. Historial de cambios significativos

| Fecha | Cambio | Impacto |
|-------|--------|---------|
| 2025 (Q4) | Liberación v1.0 — sync engine básico | Producción en primer cliente |
| 2026-02-03 | Fix de items huérfanos: switch a `/inventories/` + `/inventories_adjustment/` | Items recién creados ahora visibles en Fracttal; assets huérfanos pre-existentes no se limpian automáticamente |
| 2026-04-07 | v1.1 Phase 1: LicenseValidator ported, env validator, license config | App ahora exige licencia válida para arrancar |
| 2026-04-08 | v1.1 Phase 2: requireLicense middleware, status endpoint, frontend banner | Kill switch operacional desde Tersoft |
| 2026-05-12 | Handoff prep — este documento | Nuevo dueño puede arrancar |

---

## 7. Para el siguiente que llegue

Cuando descubras algo que no esté aquí y pienses "ojalá lo hubiera sabido antes": añádelo. Este documento es valioso en proporción directa a cuán actualizado esté. No le tengas miedo a sumar secciones nuevas.

Convención sugerida: nuevas secciones al final, manteniendo numeración consecutiva. Si reorganizas, deja una entrada en sección 6 ("Historial de cambios significativos") indicándolo.
