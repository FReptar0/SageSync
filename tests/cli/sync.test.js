'use strict';

/**
 * Unit tests for the one-shot CLI src/sync.js (npm run sync / sync:moved / *:preview):
 * SYNC_DRY_RUN in the .env forces a dry-run even without --dry-run, false keeps
 * the real write path (the initial load depends on it), and an invalid value
 * aborts before touching Sage or Fracttal.
 *
 * process.exit is replaced by a function that throws, so runSync stops where the
 * real process would. The success path calls exit(0) inside its try, so the
 * throw lands in the catch, which calls exit(1): the test reads the FIRST call.
 */

jest.mock('../../src/app', () => ({
    syncInventory: jest.fn(),
    syncInventoryMoved: jest.fn()
}));
jest.mock('../../src/utils/validateEnv', () => ({ validateEnv: jest.fn() }));
jest.mock('../../src/services/LicenseValidator', () => ({ validate: jest.fn() }));

const { syncInventory, syncInventoryMoved } = require('../../src/app');
const { validateEnv } = require('../../src/utils/validateEnv');
const { runSync } = require('../../src/sync');

const originalArgv = process.argv;
let exitSpy;
let errorSpy;
let logSpy;

beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.SYNC_DRY_RUN;
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => {
        throw new Error(`exit ${code}`);
    });
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    syncInventory.mockResolvedValue({ processedItems: 0, errors: 0, preview: [] });
    syncInventoryMoved.mockResolvedValue({ processedItems: 0, errors: 0, preview: [] });
});

afterEach(() => {
    process.argv = originalArgv;
    delete process.env.SYNC_DRY_RUN;
    exitSpy.mockRestore();
    errorSpy.mockRestore();
    logSpy.mockRestore();
});

async function run(args) {
    process.argv = ['node', 'src/sync.js', ...args];
    await runSync().catch(() => {});
}

test('without SYNC_DRY_RUN, npm run sync writes (dryRun false) and exits 0', async () => {
    await run([]);
    expect(syncInventory).toHaveBeenCalledWith({ dryRun: false });
    expect(exitSpy.mock.calls[0][0]).toBe(0);
});

test('SYNC_DRY_RUN=false keeps the real write path', async () => {
    process.env.SYNC_DRY_RUN = 'false';
    await run(['--moved']);
    expect(syncInventoryMoved).toHaveBeenCalledWith({ dryRun: false });
});

test('SYNC_DRY_RUN=true forces a dry-run even without --dry-run', async () => {
    process.env.SYNC_DRY_RUN = 'true';
    await run([]);
    expect(syncInventory).toHaveBeenCalledWith({ dryRun: true });
    expect(exitSpy.mock.calls[0][0]).toBe(0);
});

test('--dry-run still works with SYNC_DRY_RUN=false', async () => {
    process.env.SYNC_DRY_RUN = 'false';
    await run(['--moved', '--dry-run']);
    expect(syncInventoryMoved).toHaveBeenCalledWith({ dryRun: true });
});

test('an invalid SYNC_DRY_RUN exits 1 before validating env or syncing', async () => {
    process.env.SYNC_DRY_RUN = 'quizas';
    await run([]);
    expect(exitSpy.mock.calls[0][0]).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('SYNC_DRY_RUN="quizas"'));
    expect(validateEnv).not.toHaveBeenCalled();
    expect(syncInventory).not.toHaveBeenCalled();
});
