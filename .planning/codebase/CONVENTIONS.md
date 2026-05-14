# Coding Conventions

**Analysis Date:** 2026-05-14

## Language and Module System

**Language:** Vanilla JavaScript (no TypeScript, no type annotations).

**Module System:** CommonJS exclusively.
- `require(...)` for imports, `module.exports = ...` for exports
- No ESM (`import`/`export`) anywhere in the codebase
- Example from `src/services/sageService.js`:
  ```javascript
  const database = require('../config/database');
  const logger = require('../config/logger');
  const ConfigManager = require('../config/configManager');
  // ...
  module.exports = SageService;
  ```

**Strict Mode:** Newer v1.1 files opt in (e.g., `tests/services/LicenseValidator.test.js` begins with `'use strict';`). Older files do not declare `'use strict'` and rely on the implicit module-level non-strict default.

**Linter/Formatter:** None checked into the repo (no `.eslintrc`, `.prettierrc`, `biome.json`, `.editorconfig`). Style is enforced by convention. Indentation is 4 spaces; single quotes for strings; semicolons everywhere.

## Mixed-Language Rule (Critical)

**Rule:** Keep the file's language when you edit it. Do not mix Spanish and English within a single file.

| Group | Files | Identifiers / Comments | Log Strings |
|-------|-------|------------------------|-------------|
| Older (Spanish) | `src/app.js`, `src/services/sageService.js`, `src/services/fracttalClient.js`, `src/maintenance.js`, `src/config/configManager.js`, `src/middleware/errorHandler.js`, all controllers, all routes | Spanish (`syncInventory`, `obtenerItems`, `// Validar configuración`) | Spanish |
| Newer v1.1 (English) | `src/services/LicenseValidator.js`, `src/middleware/requireLicense.js`, `src/utils/validateEnv.js`, `src/config/license.js`, `src/sync.js` | English (`validate`, `_doValidate`, `// HMAC Signature Verification`) | English logs go to `logger`; Spanish user-facing strings still go to API responses |

**User-facing logs are Spanish everywhere.** Even English files emit Spanish strings when the message is consumer-facing (e.g., `requireLicense` returns `'Licencia inactiva. Contacte a su proveedor.'`).

## Naming Patterns

**Files:**
- camelCase for service/utility files: `sageService.js`, `fracttalClient.js`, `configManager.js`, `validateEnv.js`
- PascalCase for files whose default export is a class with a capitalized identifier matching the file name: `LicenseValidator.js` (exports `module.exports = { validate, isValid, getStatus, _reset }`, but file is named after the conceptual class)
- camelCase for middleware: `errorHandler.js`, `requireLicense.js`
- kebab/lowercase for scripts: `setup-automap.js`, `install-service.ps1`

**Classes (PascalCase):**
- `SageService`, `FracttalClient`, `ConfigManager`, `SyncStateManager`
- Declared with `class Foo { ... }` and exported via `module.exports = Foo`

**Functions (camelCase):**
- Public: `syncInventory`, `validateEnv`, `requireLicense`, `getAccessToken`, `createInventoryWithWarehouse`, `adjustInventoryStock`, `mapSageLocationToFracttalWarehouse`
- Internal-only (prefixed with `_`): `_doValidate`, `_buildResult`, `_checkErrorTTL`, `_checkDns`, `_isPrivateOrLoopback`, `_reset`

**Constants:**
- `UPPER_SNAKE_CASE` for module-level constants in newer English files (`src/services/LicenseValidator.js`):
  ```javascript
  const FRESHNESS_WINDOW_MS = 5 * 60 * 1000;
  const ERROR_TTL_MS = 24 * 60 * 60 * 1000;
  const STARTUP_RETRIES = 3;
  ```
- Older Spanish files prefer `const` with camelCase or lowercase for query strings and ad-hoc values.

**Environment variables:** `UPPER_SNAKE_CASE` (`FRACTTAL_CLIENT_ID`, `LICENSE_API_URL`, `HMAC_SECRET`, `SAGESYNC_API_KEY`, `DB_HOST`, `LOG_LEVEL`). Validated centrally in `src/utils/validateEnv.js`.

**Variables in services:**
- camelCase across both languages
- Local in Spanish files often Spanish (`almacen`, `ubicacion`, `itemCodigo`); local in English files English (`hostname`, `addresses`, `payload`)

## Code Style

**Formatting:**
- 4-space indentation across the repo
- Single quotes for strings (only switch to backticks for template literals)
- Semicolons terminate every statement
- Trailing commas on object/array literals are inconsistent — match what's already in the file

**Line Length:**
- Soft limit ~120 chars; long log strings are commonly inline rather than broken
- Multi-line objects use one property per line

**Async Style:**
- `async`/`await` everywhere; no `.then()` chains for primary flow
- Top-level scripts (`src/main.js`, `src/app.js`, `src/sync.js`) wrap the entry promise with `.catch(...)` to log and `process.exit(1)`

## Import Organization

Imports are grouped top-of-file with no enforced order. The de-facto convention by file:

1. Node built-ins (`crypto`, `path`, `fs`, `dns`)
2. Third-party packages (`express`, `axios`, `node-cron`, `mssql`, `winston`)
3. Local config (`./config/logger`, `./config/server`, `./config/license`)
4. Local services (`./services/sageService`, `./services/fracttalClient`)
5. Local middleware/routes (`./middleware/...`, `./routes`)
6. `require('dotenv').config()` is called inside each module that reads `process.env` directly (no central bootstrap)

Example from `src/services/LicenseValidator.js`:
```javascript
const crypto = require('crypto');
const dns = require('dns');
const { URL } = require('url');
const axios = require('axios');
const licenseConfig = require('../config/license');
const logger = require('../config/logger');
```

**Path aliases:** None. Always relative paths (`../config/logger`, `./middleware/errorHandler`).

## Logger Usage (Mandatory)

**Singleton import:**
```javascript
const logger = require('../config/logger');  // from any service
const logger = require('./config/logger');   // from src/main.js etc.
```
Defined once in `src/config/logger.js` as a Winston instance with JSON format, file rotation (10MB × 5 files), and console transport only when `NODE_ENV !== 'production'`.

**Never `console.log` in production paths.** Use `logger.info` instead. Older Spanish files occasionally pair both (`console.log(...)` for live operator feedback during long syncs + `logger.info(...)` for the persistent log) — this is acceptable in service files that are also invoked as scripts (`src/app.js`), but new code should prefer `logger` only.

**Levels:**
- `logger.info` — normal operation (`'Iniciando proceso de sincronización de inventario...'`, `'Item ITEM001 creado exitosamente'`)
- `logger.warn` — recoverable issue, skipped item, deprecation, license softer failure (`'License invalid — skipping scheduled sync'`, `'DEPRECATED: createWarehouseItem - usar createInventoryItem en su lugar'`)
- `logger.error` — real failure, thrown exception (`'Error en la sincronización de inventario:'`)
- `logger.debug` — only emitted when `LOG_LEVEL=debug` is set in `.env`

**Tests mock the logger** to keep output clean. From `tests/setup.js`:
```javascript
jest.mock('../src/config/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));
```

## Error Handling Pattern (Network Calls)

**Canonical try/catch around every external call.** Pattern repeated throughout `src/services/fracttalClient.js` and `src/services/sageService.js`:

```javascript
async adjustInventoryStock(itemCode, warehouseData) {
    try {
        logger.info(`Ajustando inventario de ${itemCode} en almacén ${warehouseData.code_warehouse || warehouseData.id_warehouse}`);

        const response = await this.client.put(`/inventories_adjustment/${itemCode}`, warehouseData);
        logger.info(`Inventario de ${itemCode} ajustado exitosamente`);
        return response.data;
    } catch (error) {
        logger.error('Error ajustando inventario:', error.response?.data || error.message);
        throw error;
    }
}
```

**Three invariants:**
1. **Log first, throw after.** Always `logger.error('Spanish prefix:', err.response?.data || err.message)` before rethrowing.
2. **Never swallow.** Always `throw error` at the end of the catch (unless the function is explicitly "best-effort", like `searchWarehouseItem` returning `null` on failure).
3. **Prefer response payload over generic message.** `error.response?.data || error.message` gives the API's actual reason when available.

**Service-level error reporting variants:**
- For auth flows in `FracttalClient`, errors are first destructured into a richer object (status, statusText, data, message), then logged and rethrown:
  ```javascript
  } catch (error) {
      const errorDetails = {
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data,
          message: error.message
      };
      logger.error('Error en autenticación con Fracttal:', errorDetails);
      throw error;
  }
  ```
- For Sage SQL queries (`src/services/sageService.js`), the full error object is logged: `logger.error('Error obteniendo items de inventario:', error)`.

## Per-Item Error Tolerance (Loop Pattern)

**Per-item failures do not abort the sync loop.** Pattern at `src/app.js:53-155`:

```javascript
for (const sageItem of sageItems) {
    try {
        // ... map location, ensure warehouse, then one of CASE A/B/C ...
        processedItems++;
    } catch (itemError) {
        errors++;
        logger.error(`Error procesando item ${sageItem.ItemNumber}:`, itemError.message);

        // No detener el proceso por errores individuales
        continue;
    }
}
```

- The outer `try`/`catch` wraps the whole sync function and rethrows; that's the only place where `syncInventory` itself fails.
- The inner loop's `try`/`catch` increments `errors`, logs the item code, and `continue`s. Counters (`processedItems`, `updatedItems`, `createdItems`, `errors`, `warehousesCreated`) survive to the final summary log.
- Within the loop, a warehouse-ensure failure is also caught locally so one bad warehouse doesn't abort everything either (lines 77-85).

**Rule:** New iteration logic in `src/app.js` MUST preserve this two-level catch shape: outer for fatal sync errors, inner per-item for `errors++; continue`.

## Express Controllers — asyncHandler Wrapper

Every controller action wraps its async function in `asyncHandler` so rejections route to the global error middleware. Defined once in `src/middleware/errorHandler.js`:

```javascript
const asyncHandler = (fn) => {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
};
```

**Required usage** in every controller (`src/controllers/*.js`):

```javascript
const { asyncHandler } = require('../middleware/errorHandler');

const getSyncStatus = asyncHandler(async (req, res) => {
    const { syncStateManager } = req.app.locals;
    const state = syncStateManager.getState();
    res.json({ /* ... */ });
});

module.exports = { getSyncStatus, /* ... */ };
```

**Rule:** Never write `async (req, res) => ...` directly on a route handler. Always wrap with `asyncHandler`. Express 4.18 does not auto-catch rejected promises in middleware, so the wrapper is what feeds the global `errorHandler` registered last in `src/main.js`.

## Global Error Handler

`src/middleware/errorHandler.js` exports `errorHandler` (4-argument signature) and is registered last in `src/main.js`:

```javascript
app.use(errorHandler);  // src/main.js:87
```

The handler distinguishes:
- `error.isOperational === true` → respond with `error.statusCode || 500` and `error.code`
- `error.name === 'ValidationError'` → 400 with `'Datos de entrada inválidos'`
- `error.code === 'ECONNREFUSED' || 'ETIMEDOUT'` → 503 with `'Servicio temporalmente no disponible'`
- Anything else → 500 with `'Error interno del servidor'`

Always logs the full context (method, path, body, query, params, ip, userAgent) before responding.

## License Gate Ordering in `src/main.js` (Don't Reorder)

The boot sequence in `src/main.js` is load-bearing. Required order:

1. `validateEnv()` — Boot-time env var check; exits with code 1 listing all missing vars (lines 22-23). Defined in `src/utils/validateEnv.js`.
2. `validateLicense({ startup: true })` — Startup license gate with retries; exits with code 1 on final failure (line 28).
3. `app = express()` then `app.use(express.json())` (lines 30-33).
4. `requireLicense` wrapper that exempts `/api/system/license` (lines 38-42):
   ```javascript
   app.use((req, res, next) => {
       if (req.path === '/api/system/license') return next();
       requireLicense(req, res, next);
   });
   ```
5. `app.use(express.static(...))` — gated by step 4 (line 44).
6. Service initialization, `app.locals` wiring, `cron.schedule(...)`, route mounting (`app.use('/api', apiRoutes)`).
7. `app.use(errorHandler)` — must be **last** middleware (line 87).

**The exemption for `/api/system/license` lives in `src/main.js`, NOT in `src/middleware/requireLicense.js`.** That middleware is intentionally single-responsibility: it returns 503 when the cached license state is not VALID, period. If you need another exempt path, add it to the wrapper in `main.js`.

## The Three-Case Sync Pattern (`src/app.js`)

Each Sage item goes through one of three branches inside the loop. Identified by `fracttal.checkItemExistsInWarehouse(itemCode, fracttalWarehouse)`:

| Case | Condition | Calls (in order) | Counter |
|------|-----------|------------------|---------|
| A | `exists && inWarehouse` | `adjustInventoryStock(itemCode, adjustmentData)` | `updatedItems++` |
| B | `exists && !inWarehouse` | `associateItemToWarehouse(...)` → `adjustInventoryStock(...)` | `createdItems++` |
| C | `!exists` | `createInventoryWithWarehouse(createData)` → `adjustInventoryStock(itemCode, adjustmentData)` | `createdItems++` |

Cases B and C are two-step on purpose — the create/associate call does NOT set real stock (it seeds 0), so a follow-up `adjustInventoryStock` is required. Removing either call breaks stock accuracy. See lines 99-139 of `src/app.js` and `CLAUDE.md` "Don't touch without thinking twice."

## Function Design

**Size:** Functions can be long when they encode a workflow. `syncInventory` in `src/app.js` is ~165 lines and that's accepted because the loop body has clear sub-stages. New utility functions should stay under ~50 lines; split if they grow.

**Parameters:**
- Positional for ≤ 3 args, then switch to an options/data object (`adjustInventoryStock(itemCode, warehouseData)`, `createInventoryWithWarehouse(itemData)`)
- Optional flag-style options take a single object: `validate({ startup: true })`

**Return values:**
- Service methods that wrap Fracttal calls return `response.data` (not the full axios response)
- "Best-effort" lookups (`searchWarehouseItem`, `getInventoryItemByCode`) return `null` on miss
- Booleans for connection probes (`validateConnection`)

## Module Design

**Exports:**
- Class files: `module.exports = ClassName;`
- Utility modules: `module.exports = { funcA, funcB };` (named export bag)
- Single-function modules: usually still bagged for symmetry (`module.exports = { syncInventory }`)

**Barrel files:** Only `src/routes/index.js`, which mounts sub-routers onto an Express `Router`. Nothing aggregates services.

**Re-imports inside functions:** Acceptable when avoiding circular imports or deferring expensive work. Example in `src/main.js:124`: the fatal-error handler re-requires the logger because the file-level `require` may be unavailable in early error paths. Don't add this pattern without a clear reason.

## Comments

**When to comment:**
- File-level JSDoc at the top of newer English files (`src/services/LicenseValidator.js`, `src/middleware/requireLicense.js`) describes purpose, exported API, and key behaviors
- Inline comments call out load-bearing ordering (e.g., `// LIC-02: Re-validate license on each cron cycle`) or document Fracttal endpoint quirks (`// POST /inventories/ - Creates item with warehouse association and stock`)
- Spanish files use Spanish prose comments (`// Validar configuración`, `// No detener el proceso por errores individuales`)

**JSDoc:**
- Newer files use `@param`/`@returns` blocks for exported functions (e.g., `verifySignature`, `validate`, `requireLicense`)
- No tooling consumes JSDoc; comments are for readers

**Don't comment out code.** Delete instead.

## Tests as a Boundary

The license modules sit behind a hard mock fence:
- Production code never mocks `LicenseValidator` — its singleton state IS the gate.
- Integration tests (`tests/integration/licenseEnforcement.test.js`) mock both `LicenseValidator` and any service that would otherwise require real credentials at module load.
- Unit tests for `LicenseValidator` use `jest.mock('axios', () => ({ create: jest.fn(() => mockAxiosClient) }))` because the module captures `axios.create()`'s return at load time. See [`TESTING.md`](./TESTING.md) for the pattern.

---

*Convention analysis: 2026-05-14*
