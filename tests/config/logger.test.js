'use strict';

/**
 * Unit tests for src/config/logger.js: the File transports get a numeric
 * maxsize and rotate tailable. Winston compares the file size against maxsize,
 * so the documented LOG_MAX_SIZE=10m (a string) never rotated sagesync.log.
 *
 * tests/setup.js mocks the logger, so each test loads the real module with its
 * log files in a temporary folder.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ENV_KEYS = ['LOG_FILE', 'LOG_MAX_SIZE', 'LOG_MAX_FILES'];
const TEN_MB = 10 * 1024 * 1024;
let savedEnv;
let tmpDir;
let logger;

beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sagesync-logger-'));
});

afterEach(() => {
    logger.close();
    for (const key of ENV_KEYS) {
        if (savedEnv[key] === undefined) delete process.env[key];
        else process.env[key] = savedEnv[key];
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Empty strings keep dotenv from filling these variables from the local .env.
function fileTransports(env) {
    Object.assign(process.env, {
        LOG_FILE: path.join(tmpDir, 'sagesync.log'),
        LOG_MAX_SIZE: '',
        LOG_MAX_FILES: ''
    }, env);
    jest.isolateModules(() => {
        logger = jest.requireActual('../../src/config/logger');
    });
    return logger.transports.filter((transport) => transport.name === 'file');
}

test('the documented LOG_MAX_SIZE=10m becomes 10 MB in bytes, 5 files, tailable', () => {
    const files = fileTransports({ LOG_MAX_SIZE: '10m' });

    expect(files).toHaveLength(2);
    for (const file of files) {
        expect(file.maxsize).toBe(TEN_MB);
        expect(file.maxFiles).toBe(5);
        expect(file.tailable).toBe(true);
    }
});

test('LOG_MAX_SIZE in plain bytes and LOG_MAX_FILES are used as numbers', () => {
    const files = fileTransports({ LOG_MAX_SIZE: '2048', LOG_MAX_FILES: '3' });

    expect(files.map((file) => file.maxsize)).toEqual([2048, 2048]);
    expect(files.map((file) => file.maxFiles)).toEqual([3, 3]);
});

test('an unreadable LOG_MAX_SIZE falls back to 10 MB', () => {
    const files = fileTransports({ LOG_MAX_SIZE: 'mucho' });

    expect(files.map((file) => file.maxsize)).toEqual([TEN_MB, TEN_MB]);
});
