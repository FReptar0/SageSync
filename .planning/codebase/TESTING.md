# Testing Patterns

**Analysis Date:** 2026-05-14

## Test Framework

**Runner:** Jest 29.7.0
- Config: `jest.config.js` at repo root
- Test environment: `node`
- Global timeout: 30s (set both in config and via `jest.setTimeout(30000)` in `tests/setup.js`)

**HTTP Testing:** supertest 6.3.4 (for Express integration tests against in-memory app instances)

**Assertion Library:** Jest built-in `expect` (no chai, no sinon — Jest's mocking primitives are used directly)

**Versions in `package.json`:**
```json
"devDependencies": {
  "javascript-obfuscator": "^5.4.1",
  "jest": "^29.7.0",
  "nodemon": "^3.0.1",
  "supertest": "^6.3.4"
}
```

## Run Commands

```bash
npm test                              # All Jest suites (jest discovers via testMatch)
npm run test:watch                    # Watch mode
npm run test:coverage                 # Generate coverage (text + lcov + html in ./coverage)
npm run test:fracttal                 # jest tests/services/fracttalClient.test.js
npm run test:sage                     # jest tests/services/sageService.test.js
npm run test:integration              # jest tests/integration/

# Manual smoke / live-sandbox scripts (plain Node, not Jest)
npm run test:api                      # node tests/manual/test-api-with-logs.js
npm run test:credentials              # node tests/manual/test-credentials.js
npm run test:workflow                 # node tests/manual/test-workflow.js (FULL end-to-end vs Fracttal sandbox)
```

## Jest Configuration (`jest.config.js`)

```javascript
module.exports = {
  testEnvironment: 'node',
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/config/logger.js',
    '!**/node_modules/**'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  testMatch: [
    '**/tests/**/*.test.js',
    '**/tests/**/*.spec.js'
  ],
  setupFilesAfterEach: ['<rootDir>/tests/setup.js'],
  testTimeout: 30000,
  verbose: true
};
```

`testMatch` discovers `.test.js`/`.spec.js` anywhere under `tests/`. The `tests/manual/*` scripts are intentionally **not** named with `.test.js` so Jest ignores them.

## Test File Organization

**Location:** `tests/` at repo root (separate from `src/`, not co-located).

**Categories:**

| Directory | Purpose | Files |
|-----------|---------|-------|
| `tests/services/` | Unit tests per service, mocks all external dependencies | `fracttalClient.test.js`, `sageService.test.js`, `LicenseValidator.test.js` |
| `tests/middleware/` | Unit tests for Express middleware in isolation | `requireLicense.test.js` |
| `tests/integration/` | Multi-module tests; spin up an Express app + supertest, mock services at module-load level | `fracttal.integration.test.js`, `licenseEnforcement.test.js` |
| `tests/manual/` | Plain-Node scripts run against real Fracttal credentials. NOT executed by Jest. | `test-workflow.js`, `test-api-with-logs.js`, `test-credentials.js`, `test-fracttal-api.js`, others |
| `tests/setup.js` | Global setup loaded via `setupFilesAfterEach` | — |

**Naming:** `<modulebase>.test.js` for Jest suites (lowercase even when target module is PascalCase: `LicenseValidator.test.js`). Manual scripts use `test-<thing>.js` (kebab-case, no `.test.js` suffix).

**Layout shape:**
```
tests/
├── setup.js                                  # global Jest setup
├── middleware/
│   └── requireLicense.test.js
├── integration/
│   ├── fracttal.integration.test.js          # real Fracttal sandbox
│   └── licenseEnforcement.test.js            # mocked app, supertest
├── manual/
│   ├── README.md
│   ├── test-workflow.js                      # FULL Sage→Fracttal flow vs sandbox
│   ├── test-api-with-logs.js
│   ├── test-credentials.js
│   ├── test-fracttal-api.js
│   └── ... 6 more
└── services/
    ├── fracttalClient.test.js
    ├── LicenseValidator.test.js
    └── sageService.test.js
```

## Global Setup (`tests/setup.js`)

Loaded by Jest for every test file via `setupFilesAfterEach`:

```javascript
// Configuración global para tests
require('dotenv').config({ path: '.env' });

// Mock del logger para evitar logs durante tests
jest.mock('../src/config/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

// Configurar timeout global para requests HTTP
jest.setTimeout(30000);
```

**Key effects:**
1. `.env` is loaded so live-credential integration tests find `FRACTTAL_CLIENT_ID` etc.
2. The Winston singleton is globally mocked so tests don't write to `logs/` or stdout — and individual tests can assert on `logger.warn.mock.calls` (as `LicenseValidator.test.js` does for DNS warnings).
3. Timeout is doubled vs. Jest's 5s default to accommodate real Fracttal sandbox latency.

## Test Structure (Suite Organization)

Standard Jest BDD with `describe` blocks. Both languages of suite names appear:
- English file names + English suite names: `tests/services/LicenseValidator.test.js`
- Spanish-domain tests sometimes use English in `describe`/`test` but Spanish in assertions (`'Licencia inactiva. Contacte a su proveedor.'`)

**Pattern:**
```javascript
describe('FracttalClient', () => {
  let fracttalClient;

  beforeEach(() => {
    fracttalClient = new FracttalClient();
    jest.clearAllMocks();
  });

  describe('authenticate', () => {
    it('should authenticate successfully with valid credentials', async () => {
      // arrange — set up mock response
      // act — call the method
      // assert — expect(...).toBe(...) / .toHaveBeenCalledWith(...)
    });
  });
});
```

Tests group by method (`describe('authenticate', ...)`, `describe('getAccessToken', ...)`) and individual cases use `it(...)` or `test(...)` interchangeably.

## Mocking — The `axios.create` Problem (Critical)

**Issue:** `LicenseValidator.js` and `FracttalClient.js` both call `axios.create(...)` at module load time and store the returned client on the module/instance. By the time `beforeEach` runs, that capture has already happened — mocking inside `beforeEach` is too late.

**Solution:** Use `jest.mock(...)` with a factory **before** requiring the module under test. Two canonical examples:

### LicenseValidator (module-load axios capture)

```javascript
// tests/services/LicenseValidator.test.js:13-20
const mockAxiosGet = jest.fn();
const mockAxiosClient = { get: mockAxiosGet };

jest.mock('axios', () => ({
    create: jest.fn(() => mockAxiosClient),
}));

jest.mock('dns');
jest.mock('../../src/config/license', () => ({
    apiUrl: 'https://test-license.example.com',
    hmacSecret: 'test-hmac-secret-key',
    apiKey: 'test-api-key',
}));

// Logger is already mocked globally by tests/setup.js

const dns = require('dns');
const licenseConfig = require('../../src/config/license');
const { validate, isValid, getStatus, _reset } = require('../../src/services/LicenseValidator');
```

The `jest.mock` calls are **hoisted** by Jest above the `require` statements, so the licenseClient inside `LicenseValidator.js` ends up holding `mockAxiosClient` instead of a real axios instance.

### FracttalClient (instance-level axios capture)

`FracttalClient`'s constructor builds its own `this.client = axios.create(...)`. The unit-test pattern in `tests/services/fracttalClient.test.js` is to:

1. Mock `axios` at the top so `axios.create` returns a stub with the right interceptor shape:
   ```javascript
   jest.mock('axios');
   mockedAxios.create = jest.fn(() => ({
     interceptors: {
       request: { use: jest.fn() },
       response: { use: jest.fn() }
     },
     get: jest.fn(),
     post: jest.fn(),
     put: jest.fn(),
     delete: jest.fn()
   }));
   ```
2. Then, in `describe('API methods')`, **replace `fracttalClient.client` outright** so each test controls the stub directly:
   ```javascript
   beforeEach(() => {
     fracttalClient.client = {
       get: jest.fn(),
       post: jest.fn(),
       put: jest.fn(),
       delete: jest.fn()
     };
     fracttalClient.getAccessToken = jest.fn().mockResolvedValue('mock_token');
   });
   ```
3. For OAuth flows (`authenticate`, `refreshAccessToken`) the real method goes through `axios.post(...)` directly (not via `this.client`), so the test stubs `mockedAxios.post = jest.fn().mockResolvedValueOnce(...)`.

**Rule:** Whenever a module under test calls `axios.create(...)` at load time or in its constructor, use a top-of-file `jest.mock('axios', ...)` factory. `beforeEach` is too late.

### Mocking ConfigManager and database

Lighter dependencies use `jest.mock('../../src/config/configManager', () => { return jest.fn().mockImplementation(() => ({ /* stub methods */ })); });` (`tests/services/fracttalClient.test.js:5-11`, `tests/services/sageService.test.js:5-22`). Note this returns the constructor mock, which Jest will call as `new ConfigManager()` and return the stub object.

`tests/services/sageService.test.js:25` does `jest.mock('../../src/config/database')` with no factory — Jest auto-mocks every exported method to `jest.fn()`, then individual tests set `database.query.mockResolvedValueOnce({ recordset: mockItems })`.

## Mocking `src/app` to Prevent `validateEnv` `process.exit`

**The problem:** `src/app.js` calls `validateEnv()` at module load (line 13). If any required env var is missing in the test environment, that call invokes `process.exit(1)` and kills the test runner. Worse, `syncController` requires `src/app`, so any test touching `apiRoutes` transitively loads `src/app.js`.

**The fix** (from `tests/integration/licenseEnforcement.test.js:46-50`):

```javascript
// Mock src/app to prevent validateEnv() from running at module load
// (syncController requires src/app which calls validateEnv() which calls process.exit)
jest.mock('../../src/app', () => ({
    syncInventory: jest.fn().mockResolvedValue(undefined),
}));
```

This factory mock replaces the module's exports before any transitive `require('../app')` resolves, so `validateEnv` never runs in the test process. Apply the same mock in any integration test that needs to mount `apiRoutes` without a real `.env`.

## Mocking the LicenseValidator for Enforcement Tests

`tests/integration/licenseEnforcement.test.js` and `tests/middleware/requireLicense.test.js` mock the validator's exported interface and drive `isValid()`/`getStatus()` per-test:

```javascript
const mockIsValid = jest.fn();
const mockGetStatus = jest.fn();

jest.mock('../../src/services/LicenseValidator', () => ({
    isValid: mockIsValid,
    getStatus: mockGetStatus,
    validate: jest.fn().mockResolvedValue({ state: 'VALID', valid: true }),
    _reset: jest.fn(),
}));
```

Then individual tests do `mockIsValid.mockReturnValue(false)` and assert 503 or 200.

## Express Integration Pattern (`supertest`)

`tests/integration/licenseEnforcement.test.js:65-94` reconstructs a minimal Express app mirroring `src/main.js` ordering, then runs requests via supertest:

```javascript
beforeAll(() => {
    testApp = express();
    testApp.use(express.json());
    testApp.use((req, res, next) => {
        if (req.path === '/api/system/license') return next();
        requireLicense(req, res, next);
    });
    testApp.use(express.static(path.join(__dirname, '../../public')));
    // ... wire app.locals.sage / fracttal / syncStateManager (mocked) ...
    testApp.use('/api', apiRoutes);
    testApp.use(errorHandler);
});

test('GET /api/status returns 503 when isValid() = false', async () => {
    mockIsValid.mockReturnValue(false);
    const res = await supertest(testApp).get('/api/status');
    expect(res.status).toBe(503);
});
```

**Rule:** Tests that exercise route + middleware behavior must reproduce `main.js`'s middleware order. If you reorder middleware in `main.js`, update the integration test scaffold to match.

## Fixtures and Test Data

There are no `fixtures/` directories. Mock data is inlined per test, often as small literal objects:

```javascript
// tests/services/sageService.test.js
const mockItems = [
  {
    ItemNumber: 'ITEM001',
    Description: 'Test Item 1',
    Location: 'WH01',
    QuantityOnHand: 10,
    MinimumStock: 5,
    StandardCost: 100.00
  },
  // ...
];
database.query.mockResolvedValueOnce({ recordset: mockItems });
```

For HMAC-signed responses in `LicenseValidator.test.js`, a helper at the top builds canonical signed payloads (lines 38-49):

```javascript
function makeSignedResponse(active, expiresAt, hmacSecret, tsOverride) {
    const payload = { active };
    if (active === true && expiresAt !== undefined) {
        payload.expiresAt = expiresAt;
    }
    payload.ts = tsOverride !== undefined ? tsOverride : Date.now();
    const sig = crypto
        .createHmac('sha256', hmacSecret)
        .update(JSON.stringify(payload), 'utf-8')
        .digest('hex');
    return { ...payload, sig };
}
```

## Time Travel (`jest.useFakeTimers`)

Used in `tests/services/LicenseValidator.test.js` to test the 24h Error TTL window without waiting 24 hours:

```javascript
afterEach(() => {
    jest.useRealTimers();
});

test('ERROR state with lastSuccessfulCheck > 24h ago transitions to INVALID', async () => {
    jest.useFakeTimers();
    const now = Date.now();
    const twentyFiveHoursAgo = now - (25 * 60 * 60 * 1000);
    jest.setSystemTime(twentyFiveHoursAgo);
    // ... record a successful check at the fake "past" ...
    jest.setSystemTime(now);
    // ... trigger a network failure and assert INVALID ...
});
```

`afterEach(() => jest.useRealTimers())` restores normal time so subsequent tests aren't affected.

## Spying on `process.exit`

`LicenseValidator.validate({ startup: true })` calls `process.exit(1)` after retries are exhausted. Tests prevent the real exit by spying:

```javascript
let exitSpy;
beforeEach(() => {
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
});
afterEach(() => {
    exitSpy.mockRestore();
});

test('all retries exhausted calls process.exit(1)', async () => {
    mockAxiosGet.mockRejectedValue(new Error('Server down'));
    await validate({ startup: true });
    expect(exitSpy).toHaveBeenCalledWith(1);
});
```

## What's Mocked vs. What Isn't

**Always mocked in unit/integration tests:**
- Winston logger (`tests/setup.js`)
- `axios` (or its `.create()` factory) for any service that hits an external HTTP API
- `mssql` via auto-mock of `src/config/database`
- `src/config/configManager` (factory mock returning stubbed methods)
- `dns` when DNS bypass behavior is being checked
- `src/app` when integration tests need to load routes without triggering `validateEnv`
- `process.exit` via `jest.spyOn` when startup gate code paths are exercised

**Never mocked:**
- `crypto` — HMAC verification tests genuinely produce and verify signatures
- `tests/integration/fracttal.integration.test.js` deliberately uses **real** Fracttal credentials and a real `FracttalClient` (it's an integration test against the Fracttal sandbox, not a unit test). It is skipped on machines without credentials only because `getAccessToken()` will fail.

## Workflow Test Against Real Sandbox

`tests/manual/test-workflow.js` (run via `npm run test:workflow`) is the closest thing to a true end-to-end check. **Not a Jest test** — plain Node script, not picked up by `testMatch`. Behavior:

1. Authenticates against the real Fracttal OAuth endpoint (requires valid `FRACTTAL_CLIENT_ID`/`FRACTTAL_CLIENT_SECRET` in `.env`)
2. Verifies / creates warehouse `TEST001` in the sandbox
3. Generates 5 dummy "Sage items" with timestamp-suffixed codes (`HERR-TAL-<6digits>`, `REPU-ROD-<6digits>`, etc.) so reruns don't collide
4. Walks through the production three-case sync logic: `POST /inventories/`, `PUT /inventories_adjustment/`, `GET /warehouses_items/`, `GET /inventories/{code}`
5. Persists a JSON result file in `logs/test-workflow-<timestamp>.json`

**Required credentials:** `.env` with real `FRACTTAL_CLIENT_ID`, `FRACTTAL_CLIENT_SECRET`, and the sandbox-configured `FRACTTAL_BASE_URL` / `FRACTTAL_OAUTH_URL`. License vars are not consulted because the script imports `FracttalClient` directly without going through `src/main.js`. **DB_*** vars are not needed because the script generates Sage data inline.

Run as part of pre-deploy verification or whenever Fracttal endpoint behavior is in question — not in CI.

## Coverage

**Threshold:** None enforced (`jest.config.js` does not set `coverageThreshold`).

**Reporters:** `text` (console summary), `lcov` (for tooling), `html` (`coverage/lcov-report/index.html`).

**Excluded:** `src/config/logger.js` (excluded via `collectCoverageFrom: ['src/**/*.js', '!src/config/logger.js', '!**/node_modules/**']`).

**View coverage:**
```bash
npm run test:coverage
# Open coverage/lcov-report/index.html in a browser
```

## Coverage Map

| Area | Test File | Coverage |
|------|-----------|----------|
| Sage SQL service | `tests/services/sageService.test.js` | Good — `getAllInventoryItems`, `getInventoryItemsByLocation`, `getInventoryItemByCode`, `getUniqueLocations`, `getInventoryStats`, `transformToFracttalFormat`, `validateConnection`. DB is mocked. |
| Fracttal client | `tests/services/fracttalClient.test.js` | Auth, refresh, getAccessToken, and the deprecated `createWarehouseItem`/`updateWarehouseItem`/`searchWarehouseItem` helpers. **Canonical methods `createInventoryWithWarehouse`, `associateItemToWarehouse`, `adjustInventoryStock` are NOT covered by Jest unit tests** — only exercised in `tests/manual/test-workflow.js` against the sandbox. |
| License validator | `tests/services/LicenseValidator.test.js` | Dense: HMAC verify, timestamp freshness, DNS warning, startup retry/exit, periodic re-check, 24h error TTL. Mapped to requirement IDs (CFG-01, CFG-02, LIC-01..04, ENF-03, ENF-04). |
| `requireLicense` middleware | `tests/middleware/requireLicense.test.js` | 503-vs-next branching, response body shape. |
| License enforcement integration | `tests/integration/licenseEnforcement.test.js` | ENF-01 + STS-01: end-to-end via supertest, verifies the `/api/system/license` exemption works. |
| Fracttal live integration | `tests/integration/fracttal.integration.test.js` | Real-credential auth + endpoint smoke; tolerates `UNAUTHORIZED_ENDPOINT` for accounts without the warehouses module. |

## Coverage Gaps

- **`src/app.js` `syncInventory` is not unit-tested.** No Jest suite exercises the three-case branching logic in isolation. Only the live `tests/manual/test-workflow.js` covers it, and that requires sandbox credentials. A regression in case routing or in the per-item error counter would not be caught by `npm test`.
- **Canonical Fracttal write methods (`createInventoryWithWarehouse`, `associateItemToWarehouse`, `adjustInventoryStock`) are not in `fracttalClient.test.js`.** The unit test file still focuses on deprecated `createWarehouseItem`/`updateWarehouseItem` paths.
- **`src/services/syncStateManager.js` has no dedicated test.** It is only exercised transitively via mocked instances in integration tests.
- **`src/middleware/errorHandler.js`** has no test — the operational/validation/ECONNREFUSED branches are unverified.
- **Controllers (`syncController`, `systemController`, `sageController`, `fracttalController`, `logsController`)** are exercised only by the one route in `licenseEnforcement.test.js` (`GET /api/status`). Other endpoints have no direct coverage.
- **`src/utils/validateEnv.js`** has no test — relies on the fact that integration tests have to mock `src/app` to avoid triggering it.
- **`src/scripts/*`** (`obfuscate.js`, `setup-automap.js`, `install-service.ps1`) are not tested.
- **End-to-end workflow needs real credentials.** `npm run test:workflow` is the only way to validate the actual Sage→Fracttal flow, and it requires a `.env` with real Fracttal sandbox credentials. There is no recorded fixture / cassette substitute.

## Common Patterns

**Async testing:**
```javascript
it('should authenticate successfully', async () => {
    mockedAxios.post = jest.fn().mockResolvedValueOnce(mockResponse);
    const token = await fracttalClient.authenticate();
    expect(token).toBe('mock_access_token');
});
```

**Error testing:**
```javascript
it('should throw error when no refresh token available', async () => {
    fracttalClient.refreshToken = null;
    await expect(fracttalClient.refreshAccessToken())
        .rejects.toThrow('No hay refresh token disponible');
});
```

**Spying on logger output (after global mock):**
```javascript
const logger = require('../../src/config/logger');

test('resolves to private IP 127.0.0.1 logs warning', async () => {
    dns.resolve4 = jest.fn((hostname, cb) => cb(null, ['127.0.0.1']));
    // ...
    await validate();
    expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('private/loopback')
    );
});
```

**Resetting between tests:**
```javascript
beforeEach(() => {
    _reset();              // LicenseValidator's internal cache
    jest.clearAllMocks();  // Reset all jest.fn() call counts
});
```

---

*Testing analysis: 2026-05-14*
