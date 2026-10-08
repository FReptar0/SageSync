'use strict';

/**
 * Unit tests for src/config/schedules.js — the pure resolver/describer for
 * SYNC_CRON_SCHEDULE (full load), SYNC_DAILY_CRON_SCHEDULE (daily/delta load)
 * and SYNC_TIMEZONE.
 *
 * Uses the real node-cron validator. Every test passes an explicit env object;
 * nothing here reads or depends on process.env.
 */

const {
    resolveSyncSchedules,
    describeSyncSchedules,
    SYNC_MODE_LABELS
} = require('../../src/config/schedules');

describe('resolveSyncSchedules', () => {
    test('defaults: full load at 02:00, no daily load, Mexico City zone, no errors', () => {
        expect(resolveSyncSchedules({})).toEqual({
            full: '0 2 * * *',
            daily: null,
            timezone: 'America/Mexico_City',
            errors: []
        });
    });

    test.each(['off', 'OFF', 'Off', 'false', 'none', 'disabled', ' Disabled '])(
        'SYNC_CRON_SCHEDULE=%p disables the full load without errors',
        (value) => {
            const result = resolveSyncSchedules({ SYNC_CRON_SCHEDULE: value });
            expect(result.full).toBeNull();
            expect(result.errors).toEqual([]);
        }
    );

    test('production recipe schedules only the daily load', () => {
        expect(resolveSyncSchedules({
            SYNC_CRON_SCHEDULE: 'off',
            SYNC_DAILY_CRON_SCHEDULE: '0 12,16,23 * * *'
        })).toEqual({
            full: null,
            daily: '0 12,16,23 * * *',
            timezone: 'America/Mexico_City',
            errors: []
        });
    });

    test.each(['', 'OFF'])(
        'SYNC_DAILY_CRON_SCHEDULE=%p leaves the daily load unscheduled without errors',
        (value) => {
            const result = resolveSyncSchedules({ SYNC_DAILY_CRON_SCHEDULE: value });
            expect(result.daily).toBeNull();
            expect(result.errors).toEqual([]);
        }
    );

    describe('whitespace normalization', () => {
        test('daily cron is trimmed and internal whitespace runs are collapsed', () => {
            const result = resolveSyncSchedules({ SYNC_DAILY_CRON_SCHEDULE: '  0  12,16,23 * * *  ' });
            expect(result.daily).toBe('0 12,16,23 * * *');
            expect(result.errors).toEqual([]);
        });

        test('timezone is trimmed', () => {
            const result = resolveSyncSchedules({ SYNC_TIMEZONE: '  America/Monterrey ' });
            expect(result.timezone).toBe('America/Monterrey');
            expect(result.errors).toEqual([]);
        });

        test('a blank SYNC_CRON_SCHEDULE falls back to the default', () => {
            const result = resolveSyncSchedules({ SYNC_CRON_SCHEDULE: '   ' });
            expect(result.full).toBe('0 2 * * *');
            expect(result.errors).toEqual([]);
        });
    });

    test('SYNC_TIMEZONE=UTC is accepted', () => {
        const result = resolveSyncSchedules({ SYNC_TIMEZONE: 'UTC' });
        expect(result.timezone).toBe('UTC');
        expect(result.errors).toEqual([]);
    });

    test('an invalid SYNC_CRON_SCHEDULE yields one error naming the variable and the value', () => {
        const { errors } = resolveSyncSchedules({ SYNC_CRON_SCHEDULE: 'cada hora' });
        expect(errors).toHaveLength(1);
        expect(errors[0].startsWith('SYNC_CRON_SCHEDULE=')).toBe(true);
        expect(errors[0]).toContain('cada hora');
    });

    test('an invalid SYNC_DAILY_CRON_SCHEDULE yields an error naming the variable and the value', () => {
        const { errors } = resolveSyncSchedules({ SYNC_DAILY_CRON_SCHEDULE: '61 * * * *' });
        expect(errors).toHaveLength(1);
        expect(errors[0].startsWith('SYNC_DAILY_CRON_SCHEDULE=')).toBe(true);
        expect(errors[0]).toContain('61 * * * *');
    });

    test('an invalid SYNC_TIMEZONE yields an error naming the variable and the value', () => {
        const { errors } = resolveSyncSchedules({ SYNC_TIMEZONE: 'Mars/Olympus' });
        expect(errors).toHaveLength(1);
        expect(errors[0].startsWith('SYNC_TIMEZONE=')).toBe(true);
        expect(errors[0]).toContain('Mars/Olympus');
    });

    test('all three invalid at once are reported together, with the exact Spanish templates', () => {
        const result = resolveSyncSchedules({
            SYNC_CRON_SCHEDULE: 'cada hora',
            SYNC_DAILY_CRON_SCHEDULE: '61 * * * *',
            SYNC_TIMEZONE: 'Mars/Olympus'
        });
        expect(result.errors).toEqual([
            'SYNC_CRON_SCHEDULE="cada hora" no es una expresión cron válida (ej. "0 2 * * *"; usa "off" para no programar la carga completa)',
            'SYNC_DAILY_CRON_SCHEDULE="61 * * * *" no es una expresión cron válida (ej. "0 12,16,23 * * *"; déjala vacía o usa "off" para no programar la carga diaria)',
            'SYNC_TIMEZONE="Mars/Olympus" no es una zona horaria IANA válida (ej. "America/Mexico_City")'
        ]);
    });

    test('invalid values stay in their fields so a caller that ignores errors fails loudly', () => {
        const result = resolveSyncSchedules({
            SYNC_CRON_SCHEDULE: 'cada hora',
            SYNC_DAILY_CRON_SCHEDULE: '61 * * * *',
            SYNC_TIMEZONE: 'Mars/Olympus'
        });
        expect(result.full).toBe('cada hora');
        expect(result.daily).toBe('61 * * * *');
        expect(result.timezone).toBe('Mars/Olympus');
    });
});

describe('describeSyncSchedules', () => {
    test('production recipe', () => {
        expect(describeSyncSchedules({
            full: null,
            daily: '0 12,16,23 * * *',
            timezone: 'America/Mexico_City'
        })).toBe('Completa: sin horario (manual) · Diaria: 0 12,16,23 * * * · Zona: America/Mexico_City');
    });

    test('defaults', () => {
        expect(describeSyncSchedules({
            full: '0 2 * * *',
            daily: null,
            timezone: 'America/Mexico_City'
        })).toBe('Completa: 0 2 * * * · Diaria: sin horario (manual) · Zona: America/Mexico_City');
    });
});

describe('SYNC_MODE_LABELS', () => {
    test('Spanish labels per load type, frozen', () => {
        expect(SYNC_MODE_LABELS).toEqual({ full: 'COMPLETA', daily: 'DIARIA (delta)' });
        expect(Object.isFrozen(SYNC_MODE_LABELS)).toBe(true);
    });
});
