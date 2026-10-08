'use strict';

/**
 * Headless mode of src/app.js (npm run sync-only).
 *
 * - Requiring src/app must have NO side effects: no cron and no startup license
 *   gate. Before the fix, every process that required it (main.js through
 *   syncController, sync.js) registered an extra, unguarded full-load cron.
 * - _startHeadless() (test-only alias of start) runs the startup license gate
 *   BEFORE registering crons, schedules with an explicit timezone (GitHub #3),
 *   keeps the immediate full run, and never overlaps runs (GitHub #9).
 *
 * Each test loads a fresh copy of src/app with jest.isolateModules, so the
 * module-level in-progress flag never leaks between tests. The mocks are
 * module-scope `mock*` objects shared through the jest.mock factories.
 */

// ---- node-cron: record schedules, never start real timers ----
const mockSchedule = jest.fn(() => ({ stop: jest.fn() }));
jest.mock('node-cron', () => ({
    schedule: mockSchedule,
    validate: jest.fn(() => true)
}));

// ---- dotenv: app.js calls config() at load; a developer's local .env must not
// re-populate the SYNC_* variables these tests set or unset ----
jest.mock('dotenv', () => ({ config: jest.fn() }));

// ---- LicenseValidator ----
const mockValidate = jest.fn();
const mockIsValid = jest.fn();
jest.mock('../../src/services/LicenseValidator', () => ({
    validate: mockValidate,
    isValid: mockIsValid,
    getStatus: jest.fn()
}));

// ---- Block validateEnv so requiring src/app doesn't exit ----
jest.mock('../../src/utils/validateEnv', () => ({
    validateEnv: jest.fn()
}));

// ---- SageService / FracttalClient (single shared mock instances) ----
const mockSage = {
    validateConnection: jest.fn(),
    getAllInventoryItems: jest.fn(),
    getMovedInventoryItems: jest.fn(),
    mapSageLocationToFracttalWarehouse: jest.fn()
};
jest.mock('../../src/services/sageService', () => {
    return jest.fn().mockImplementation(() => mockSage);
});

const mockFracttal = {
    getAccessToken: jest.fn()
};
jest.mock('../../src/services/fracttalClient', () => {
    return jest.fn().mockImplementation(() => mockFracttal);
});

// ---- ConfigManager (validateConfig passes, no filters) ----
jest.mock('../../src/config/configManager', () => {
    return jest.fn().mockImplementation(() => ({
        validateConfig: jest.fn().mockReturnValue(true),
        getInventoryFilters: jest.fn().mockReturnValue({ itemBracketId: null, segment1Excluded: [] }),
        getLocationMapping: jest.fn().mockReturnValue({ fracttalWarehouseCode: 'ALM-AMP', specialRules: [] })
    }));
});

const SCHEDULE_VARS = ['SYNC_CRON_SCHEDULE', 'SYNC_DAILY_CRON_SCHEDULE', 'SYNC_TIMEZONE'];

const flush = () => new Promise((resolve) => setImmediate(resolve));

// Fresh module state per test, plus the logger instance that copy of app.js uses.
function loadApp() {
    let app;
    let logger;
    jest.isolateModules(() => {
        app = require('../../src/app');
        logger = require('../../src/config/logger');
    });
    return { app, logger };
}

function useDailyOnlyEnv() {
    process.env.SYNC_CRON_SCHEDULE = 'off';
    process.env.SYNC_DAILY_CRON_SCHEDULE = '0 12,16,23 * * *';
}

let savedEnv;

beforeEach(() => {
    jest.clearAllMocks();

    savedEnv = {};
    for (const name of SCHEDULE_VARS) {
        savedEnv[name] = process.env[name];
        delete process.env[name];
    }

    mockValidate.mockResolvedValue({ state: 'VALID', valid: true });
    mockIsValid.mockReturnValue(true);
    mockSage.validateConnection.mockResolvedValue(true);
    mockFracttal.getAccessToken.mockResolvedValue('token');
    mockSage.getAllInventoryItems.mockResolvedValue([]);
    mockSage.getMovedInventoryItems.mockResolvedValue([]);
});

afterEach(() => {
    for (const name of SCHEDULE_VARS) {
        if (savedEnv[name] === undefined) {
            delete process.env[name];
        } else {
            process.env[name] = savedEnv[name];
        }
    }
});

describe('src/app.js headless mode', () => {
    test('requiring src/app schedules nothing and does not run the startup license gate', async () => {
        loadApp();
        await flush();

        expect(mockSchedule).not.toHaveBeenCalled();
        expect(mockValidate).not.toHaveBeenCalled();
    });

    test('daily-only env: license gate first, one daily cron in Mexico City time, immediate full run kept', async () => {
        useDailyOnlyEnv();
        const { app, logger } = loadApp();

        await app._startHeadless();

        expect(mockValidate.mock.calls[0]).toEqual([{ startup: true }]);
        expect(mockValidate.mock.invocationCallOrder[0])
            .toBeLessThan(mockSchedule.mock.invocationCallOrder[0]);
        expect(mockSchedule).toHaveBeenCalledTimes(1);
        expect(mockSchedule).toHaveBeenCalledWith(
            '0 12,16,23 * * *',
            expect.any(Function),
            { timezone: 'America/Mexico_City' }
        );
        expect(mockSage.getAllInventoryItems).toHaveBeenCalledTimes(1);
        expect(logger.error).not.toHaveBeenCalled();
    });

    test('defaults (all three vars unset): one full-load cron at 02:00 in Mexico City time', async () => {
        const { app, logger } = loadApp();

        await app._startHeadless();

        expect(mockSchedule).toHaveBeenCalledTimes(1);
        expect(mockSchedule).toHaveBeenCalledWith(
            '0 2 * * *',
            expect.any(Function),
            { timezone: 'America/Mexico_City' }
        );

        // The full-load tick runs syncInventory (the immediate run was the first call).
        await mockSchedule.mock.calls[0][1]();
        expect(mockSage.getAllInventoryItems).toHaveBeenCalledTimes(2);
        expect(mockSage.getMovedInventoryItems).not.toHaveBeenCalled();
        expect(logger.error).not.toHaveBeenCalled();
    });

    test('headless runs never overlap (GitHub #9)', async () => {
        useDailyOnlyEnv();
        const { app, logger } = loadApp();
        await app._startHeadless();
        const dailyTick = mockSchedule.mock.calls[0][1];

        let finishFirstRun;
        mockSage.getMovedInventoryItems.mockReturnValueOnce(
            new Promise((resolve) => { finishFirstRun = resolve; })
        );

        // Tick 1 starts and stays blocked reading Sage.
        const firstTick = dailyTick();
        await flush();

        // Tick 2 fires while tick 1 is still running: it must be skipped.
        await dailyTick();
        expect(mockSage.getMovedInventoryItems).toHaveBeenCalledTimes(1);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('ya hay una en progreso'));

        // Tick 1 finishes; tick 3 runs normally.
        finishFirstRun([]);
        await firstTick;
        await dailyTick();
        expect(mockSage.getMovedInventoryItems).toHaveBeenCalledTimes(2);
    });
});
