'use strict';

/**
 * Unit tests for src/controllers/syncController.js:
 * - runSyncWithTracking picks the load by mode ('full' -> syncInventory,
 *   'daily' -> syncInventoryMoved) and records the mode in the sync history;
 * - manualSync (dashboard button = manual full load) runs in the background
 *   and a failing run never becomes an unhandled rejection.
 *
 * src/app is mocked with a factory, so it is never loaded (it calls
 * validateEnv at load). SyncStateManager is the real class.
 */

jest.mock('../../src/app', () => ({
    syncInventory: jest.fn(),
    syncInventoryMoved: jest.fn()
}));

const { syncInventory, syncInventoryMoved } = require('../../src/app');
const SyncStateManager = require('../../src/services/syncStateManager');
const { runSyncWithTracking, manualSync } = require('../../src/controllers/syncController');

const flush = () => new Promise((resolve) => setImmediate(resolve));

let logSpy;
let errorSpy;

beforeEach(() => {
    jest.clearAllMocks();
    // runSyncWithTracking prints emojis to the console; keep test output clean.
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
});

describe('runSyncWithTracking', () => {
    test('default mode runs the full load and records mode "full" in history', async () => {
        syncInventory.mockResolvedValue({ totalItems: 3, processedItems: 3, errors: 0 });
        const sm = new SyncStateManager();

        await runSyncWithTracking(sm);

        expect(syncInventory).toHaveBeenCalledTimes(1);
        expect(syncInventory).toHaveBeenCalledWith();
        expect(syncInventoryMoved).not.toHaveBeenCalled();
        expect(sm.getHistory()[0]).toMatchObject({ success: true, mode: 'full', processedItems: 3 });
    });

    test('mode "daily" runs the delta load and records mode "daily"', async () => {
        syncInventoryMoved.mockResolvedValue({ totalItems: 4, processedItems: 4, errors: 0 });
        const sm = new SyncStateManager();

        await runSyncWithTracking(sm, { mode: 'daily' });

        expect(syncInventoryMoved).toHaveBeenCalledTimes(1);
        expect(syncInventoryMoved).toHaveBeenCalledWith();
        expect(syncInventory).not.toHaveBeenCalled();
        expect(sm.getHistory()[0].mode).toBe('daily');
        expect(sm.getState().lastResult.mode).toBe('daily');
    });

    test('an unknown mode falls back to the full load', async () => {
        syncInventory.mockResolvedValue({ processedItems: 0 });
        const sm = new SyncStateManager();

        await runSyncWithTracking(sm, { mode: 'weekly' });

        expect(syncInventory).toHaveBeenCalledTimes(1);
        expect(syncInventoryMoved).not.toHaveBeenCalled();
        expect(sm.getHistory()[0].mode).toBe('full');
    });

    test('a failing daily load rejects with its error, is recorded with mode "daily", and frees the state', async () => {
        const boom = new Error('boom');
        syncInventoryMoved.mockRejectedValue(boom);
        const sm = new SyncStateManager();

        await expect(runSyncWithTracking(sm, { mode: 'daily' })).rejects.toBe(boom);

        expect(sm.getHistory()[0]).toMatchObject({ success: false, error: 'boom', mode: 'daily' });
        expect(sm.isInProgress()).toBe(false);
    });
});

describe('manualSync (dashboard button = manual full load)', () => {
    test('a failing background run is recorded in history and does not become an unhandled rejection', async () => {
        syncInventory.mockRejectedValue(new Error('SQL no disponible'));
        const sm = new SyncStateManager();
        const req = { app: { locals: { syncStateManager: sm } } };
        const res = { status: jest.fn(), json: jest.fn() };
        res.status.mockReturnValue(res);
        res.json.mockReturnValue(res);
        const next = jest.fn();

        manualSync(req, res, next);

        // Let the background run fail while this test is still running.
        // Detecting the unhandled rejection: Jest 29 (jest-circus) listens for
        // 'unhandledRejection' on the real process and fails the running test
        // with that error. A process.on('unhandledRejection') spy registered
        // here would never fire, because each test file gets a copied
        // `process` object that Node does not emit on (verified 2026-10-08).
        await flush();
        await flush();

        expect(res.status).not.toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith({ message: 'Sincronización iniciada', inProgress: true });
        expect(next).not.toHaveBeenCalled();
        const history = sm.getHistory();
        expect(history).toHaveLength(1);
        expect(history[0]).toMatchObject({ success: false, error: 'SQL no disponible', mode: 'full' });
        expect(sm.isInProgress()).toBe(false);
    });

    test('a sync already in progress answers 409 and starts nothing', async () => {
        const sm = new SyncStateManager();
        sm.startSync();
        const req = { app: { locals: { syncStateManager: sm } } };
        const res = { status: jest.fn(), json: jest.fn() };
        res.status.mockReturnValue(res);
        res.json.mockReturnValue(res);

        manualSync(req, res, jest.fn());
        await flush();

        expect(res.status).toHaveBeenCalledWith(409);
        expect(res.json).toHaveBeenCalledWith({ error: 'Sincronización ya en progreso', inProgress: true });
        expect(syncInventory).not.toHaveBeenCalled();
    });
});
