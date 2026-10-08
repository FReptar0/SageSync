'use strict';

/**
 * Unit tests for src/services/syncScheduler.js — one cron per enabled load type
 * with an explicit timezone, and license/in-progress guarded ticks.
 *
 * node-cron, LicenseValidator and syncController are mocked: no real cron is
 * scheduled, no license server is contacted, and src/app.js (which calls
 * validateEnv at load) is never required.
 */

jest.mock('node-cron', () => ({
    schedule: jest.fn(() => ({ stop: jest.fn() })),
    validate: jest.fn(() => true)
}));

jest.mock('../../src/services/LicenseValidator', () => ({
    validate: jest.fn(),
    isValid: jest.fn(),
    getStatus: jest.fn()
}));

jest.mock('../../src/controllers/syncController', () => ({
    runSyncWithTracking: jest.fn()
}));

const cron = require('node-cron');
const { validate, isValid } = require('../../src/services/LicenseValidator');
const { runSyncWithTracking } = require('../../src/controllers/syncController');
const logger = require('../../src/config/logger');
const { registerSyncSchedules, runScheduledSync } = require('../../src/services/syncScheduler');

const PRODUCTION = { full: null, daily: '0 12,16,23 * * *', timezone: 'America/Mexico_City', errors: [] };
const BOTH_UTC = { full: '0 2 * * *', daily: '0 12,16,23 * * *', timezone: 'UTC', errors: [] };

function makeStateManager({ inProgress = false } = {}) {
    return { isInProgress: jest.fn(() => inProgress) };
}

beforeEach(() => {
    jest.clearAllMocks();
    validate.mockResolvedValue({ state: 'VALID', valid: true });
    isValid.mockReturnValue(true);
    runSyncWithTracking.mockResolvedValue(undefined);
});

describe('registerSyncSchedules', () => {
    test('production recipe registers only the daily cron, in the Mexico City zone', () => {
        const tasks = registerSyncSchedules(PRODUCTION, makeStateManager());

        expect(cron.schedule).toHaveBeenCalledTimes(1);
        expect(cron.schedule).toHaveBeenCalledWith(
            '0 12,16,23 * * *',
            expect.any(Function),
            { timezone: 'America/Mexico_City' }
        );
        expect(tasks).toHaveLength(1);
    });

    test('both loads enabled: full first, then daily, both with the configured zone', () => {
        const tasks = registerSyncSchedules(BOTH_UTC, makeStateManager());

        expect(cron.schedule).toHaveBeenCalledTimes(2);
        expect(cron.schedule.mock.calls[0]).toEqual(['0 2 * * *', expect.any(Function), { timezone: 'UTC' }]);
        expect(cron.schedule.mock.calls[1]).toEqual(['0 12,16,23 * * *', expect.any(Function), { timezone: 'UTC' }]);
        expect(tasks).toHaveLength(2);
    });

    test('nothing is scheduled when both loads are off', () => {
        const tasks = registerSyncSchedules(
            { full: null, daily: null, timezone: 'America/Mexico_City', errors: [] },
            makeStateManager()
        );

        expect(cron.schedule).not.toHaveBeenCalled();
        expect(tasks).toEqual([]);
    });
});

describe('scheduled tick', () => {
    test('invalid license: periodic validate() with no arguments, no run, log-tail warning', async () => {
        isValid.mockReturnValue(false);
        const sm = makeStateManager();
        registerSyncSchedules(PRODUCTION, sm);

        await cron.schedule.mock.calls[0][1]();

        expect(validate).toHaveBeenCalledTimes(1);
        expect(validate.mock.calls[0]).toEqual([]);
        expect(runSyncWithTracking).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('License invalid — skipping scheduled sync')
        );
    });

    test('a sync already in progress: no run, Spanish warning', async () => {
        const sm = makeStateManager({ inProgress: true });
        registerSyncSchedules(PRODUCTION, sm);

        await cron.schedule.mock.calls[0][1]();

        expect(runSyncWithTracking).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('ya hay una en progreso'));
    });

    test('valid license and idle: the daily tick runs the daily load', async () => {
        const sm = makeStateManager();
        registerSyncSchedules(PRODUCTION, sm);

        await cron.schedule.mock.calls[0][1]();

        expect(runSyncWithTracking).toHaveBeenCalledTimes(1);
        expect(runSyncWithTracking).toHaveBeenCalledWith(sm, { mode: 'daily' });
    });

    test('each tick passes its own mode: full task -> full, daily task -> daily', async () => {
        const sm = makeStateManager();
        registerSyncSchedules(BOTH_UTC, sm);

        await cron.schedule.mock.calls[0][1]();
        await cron.schedule.mock.calls[1][1]();

        expect(runSyncWithTracking).toHaveBeenCalledTimes(2);
        expect(runSyncWithTracking.mock.calls[0]).toEqual([sm, { mode: 'full' }]);
        expect(runSyncWithTracking.mock.calls[1]).toEqual([sm, { mode: 'daily' }]);
    });

    test('a failing run never rejects the tick and is logged as an error', async () => {
        runSyncWithTracking.mockRejectedValue(new Error('boom'));
        const sm = makeStateManager();
        registerSyncSchedules(PRODUCTION, sm);

        await expect(cron.schedule.mock.calls[0][1]()).resolves.toBeUndefined();

        expect(logger.error).toHaveBeenCalledTimes(1);
        expect(logger.error).toHaveBeenCalledWith(
            expect.stringContaining('Error en sincronización programada'),
            expect.any(Error)
        );
    });
});

describe('runScheduledSync', () => {
    test('a license check that throws is logged and does not reject', async () => {
        validate.mockRejectedValue(new Error('license server down'));

        await expect(runScheduledSync('daily', makeStateManager())).resolves.toBeUndefined();

        expect(runSyncWithTracking).not.toHaveBeenCalled();
        expect(logger.error).toHaveBeenCalledTimes(1);
    });
});
