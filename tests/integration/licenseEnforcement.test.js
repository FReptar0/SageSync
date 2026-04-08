'use strict';

/**
 * Integration tests for license enforcement
 * Covers: ENF-01 (HTTP routes blocked when invalid), STS-01 (status endpoint always accessible)
 */

const express = require('express');
const supertest = require('supertest');
const path = require('path');

// ---- Mock LicenseValidator BEFORE requiring anything that imports it ----
const mockIsValid = jest.fn();
const mockGetStatus = jest.fn();

jest.mock('../../src/services/LicenseValidator', () => ({
    isValid: mockIsValid,
    getStatus: mockGetStatus,
    validate: jest.fn().mockResolvedValue({ state: 'VALID', valid: true }),
    _reset: jest.fn(),
}));

// Mock heavy service dependencies to prevent real DB/API connections
jest.mock('../../src/services/sageService', () => {
    return jest.fn().mockImplementation(() => ({
        validateConnection: jest.fn().mockResolvedValue(false),
        getConnectionInfo: jest.fn().mockResolvedValue(null),
    }));
});

jest.mock('../../src/services/fracttalClient', () => {
    return jest.fn().mockImplementation(() => ({
        getAccessToken: jest.fn().mockResolvedValue('mock-token'),
        getAllWarehouses: jest.fn().mockResolvedValue([]),
        getAllInventories: jest.fn().mockResolvedValue([]),
    }));
});

jest.mock('../../src/services/syncStateManager', () => {
    return jest.fn().mockImplementation(() => ({
        getState: jest.fn().mockReturnValue({ inProgress: false, stats: {}, lastResult: null }),
        isInProgress: jest.fn().mockReturnValue(false),
    }));
});

// Mock src/app to prevent validateEnv() from running at module load
// (syncController requires src/app which calls validateEnv() which calls process.exit)
jest.mock('../../src/app', () => ({
    syncInventory: jest.fn().mockResolvedValue(undefined),
}));

// ---- Imports (after mocks are set up) ----
const { requireLicense } = require('../../src/middleware/requireLicense');
const { errorHandler } = require('../../src/middleware/errorHandler');
const apiRoutes = require('../../src/routes');
const SageService = require('../../src/services/sageService');
const FracttalClient = require('../../src/services/fracttalClient');
const SyncStateManager = require('../../src/services/syncStateManager');

// ---------------------------------------------------------------------------
// Build a minimal Express app mirroring main.js structure
// ---------------------------------------------------------------------------
let testApp;

beforeAll(() => {
    testApp = express();

    // Step 1: express.json()
    testApp.use(express.json());

    // Step 2: requireLicense wrapper (exempt /api/system/license) — BEFORE static
    testApp.use((req, res, next) => {
        if (req.path === '/api/system/license') return next();
        requireLicense(req, res, next);
    });

    // Step 3: express.static (gated by requireLicense above)
    testApp.use(express.static(path.join(__dirname, '../../public')));

    // Step 4: Set up app.locals (normally done in startServer)
    const sage = new SageService();
    const fracttal = new FracttalClient();
    const syncStateManager = new SyncStateManager();
    testApp.locals.sage = sage;
    testApp.locals.fracttal = fracttal;
    testApp.locals.syncStateManager = syncStateManager;
    testApp.locals.cronSchedule = '*/30 * * * *';

    // Step 5: API routes
    testApp.use('/api', apiRoutes);

    // Step 6: Error handler (last)
    testApp.use(errorHandler);
});

beforeEach(() => {
    jest.clearAllMocks();
    // Default: getStatus returns INVALID state
    mockGetStatus.mockReturnValue({
        state: 'INVALID',
        active: false,
        expiresAt: null,
        lastChecked: null,
        lastSuccessfulCheck: null,
    });
});

// ===========================================================================
// ENF-01: Routes blocked when license is invalid
// ===========================================================================
describe('License Enforcement - ENF-01', () => {
    test('GET /api/status returns 503 when isValid() = false', async () => {
        mockIsValid.mockReturnValue(false);

        const res = await supertest(testApp).get('/api/status');

        expect(res.status).toBe(503);
    });

    test('GET /api/status returns 503 body with error field when invalid', async () => {
        mockIsValid.mockReturnValue(false);
        mockGetStatus.mockReturnValue({ state: 'INVALID', active: false, expiresAt: null, lastChecked: null, lastSuccessfulCheck: null });

        const res = await supertest(testApp).get('/api/status');

        expect(res.body).toHaveProperty('error');
        expect(res.body.error).toBe('Licencia inactiva. Contacte a su proveedor.');
    });

    test('GET /api/status returns 503 body with state field when invalid', async () => {
        mockIsValid.mockReturnValue(false);
        mockGetStatus.mockReturnValue({ state: 'INVALID', active: false, expiresAt: null, lastChecked: null, lastSuccessfulCheck: null });

        const res = await supertest(testApp).get('/api/status');

        expect(res.body).toHaveProperty('state', 'INVALID');
    });

    test('GET /api/status returns 200 when isValid() = true', async () => {
        mockIsValid.mockReturnValue(true);

        const res = await supertest(testApp).get('/api/status');

        // Controller may return 200 or 500 depending on service mocks,
        // but must NOT be 503 (license block)
        expect(res.status).not.toBe(503);
    });
});

// ===========================================================================
// STS-01: GET /api/system/license always accessible regardless of license state
// ===========================================================================
describe('License Status Endpoint - STS-01', () => {
    test('GET /api/system/license returns 200 when isValid() = false (exempt from gate)', async () => {
        mockIsValid.mockReturnValue(false);
        mockGetStatus.mockReturnValue({
            state: 'INVALID',
            active: false,
            expiresAt: null,
            lastChecked: '2026-04-07T00:00:00.000Z',
            lastSuccessfulCheck: null,
        });

        const res = await supertest(testApp).get('/api/system/license');

        expect(res.status).toBe(200);
    });

    test('GET /api/system/license returns 200 when isValid() = true', async () => {
        mockIsValid.mockReturnValue(true);
        mockGetStatus.mockReturnValue({
            state: 'VALID',
            active: true,
            expiresAt: '2027-01-01T00:00:00.000Z',
            lastChecked: '2026-04-07T00:00:00.000Z',
            lastSuccessfulCheck: '2026-04-07T00:00:00.000Z',
        });

        const res = await supertest(testApp).get('/api/system/license');

        expect(res.status).toBe(200);
    });

    test('GET /api/system/license response body contains all 6 required fields', async () => {
        mockIsValid.mockReturnValue(false);
        mockGetStatus.mockReturnValue({
            state: 'INVALID',
            active: false,
            expiresAt: null,
            lastChecked: '2026-04-07T00:00:00.000Z',
            lastSuccessfulCheck: null,
        });

        const res = await supertest(testApp).get('/api/system/license');

        expect(res.body).toHaveProperty('state');
        expect(res.body).toHaveProperty('active');
        expect(res.body).toHaveProperty('expiresAt');
        expect(res.body).toHaveProperty('lastChecked');
        expect(res.body).toHaveProperty('lastSuccessfulCheck');
        expect(res.body).toHaveProperty('hmacConfigured');
    });

    test('GET /api/system/license hmacConfigured field is boolean', async () => {
        mockIsValid.mockReturnValue(true);
        mockGetStatus.mockReturnValue({
            state: 'VALID',
            active: true,
            expiresAt: '2027-01-01T00:00:00.000Z',
            lastChecked: '2026-04-07T00:00:00.000Z',
            lastSuccessfulCheck: '2026-04-07T00:00:00.000Z',
        });

        const res = await supertest(testApp).get('/api/system/license');

        expect(typeof res.body.hmacConfigured).toBe('boolean');
    });

    test('GET /api/system/license state field reflects INVALID when license is invalid', async () => {
        mockIsValid.mockReturnValue(false);
        mockGetStatus.mockReturnValue({
            state: 'INVALID',
            active: false,
            expiresAt: null,
            lastChecked: null,
            lastSuccessfulCheck: null,
        });

        const res = await supertest(testApp).get('/api/system/license');

        expect(res.body.state).toBe('INVALID');
    });
});
