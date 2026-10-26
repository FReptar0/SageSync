'use strict';

/**
 * Unit tests for src/utils/logParser.js (dashboard "Logs Recientes").
 *
 * A big sagesync.log (an initial load writes tens of thousands of lines) used
 * to break the viewer with "Maximum call stack size exceeded": every parsed
 * line was spread as an argument of Array.push. fs is mocked, so no file is
 * written.
 */

const fs = require('fs');
const LogParser = require('../../src/utils/logParser');

afterEach(() => {
    jest.restoreAllMocks();
});

function bigLog(lineCount) {
    const lines = new Array(lineCount);
    for (let i = 0; i < lineCount; i++) {
        const second = String(i % 60).padStart(2, '0');
        lines[i] = `{"level":"info","message":"linea ${i}","service":"sagesync","timestamp":"2026-10-26 13:20:${second}"}`;
    }
    return lines.join('\n') + '\n';
}

test('a log with 200,000 lines is read without a stack overflow', async () => {
    const content = bigLog(200000);
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs, 'readFileSync').mockImplementation((file) =>
        String(file).endsWith('sagesync.log') ? content : ''
    );

    const logs = await new LogParser('logs').readLogs('all', 100);

    expect(logs).toHaveLength(100);
    expect(logs.some((log) => String(log.content).startsWith('Error leyendo archivo'))).toBe(false);
    expect(logs[0].file).toBe('sagesync.log');
});
