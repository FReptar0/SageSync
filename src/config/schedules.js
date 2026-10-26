'use strict';

/**
 * Sync schedule resolution (pure).
 *
 * Turns three operator-edited variables into the cron expressions the entry
 * points schedule:
 *   - SYNC_CRON_SCHEDULE        FULL load (syncInventory). Empty -> '0 2 * * *'
 *                               (previous behavior); off/false/none/disabled -> not scheduled.
 *   - SYNC_DAILY_CRON_SCHEDULE  DAILY/delta load (syncInventoryMoved). Empty or an
 *                               off-value -> not scheduled.
 *   - SYNC_TIMEZONE             IANA zone used for every cron.schedule.
 *                               Empty -> 'America/Mexico_City' (GitHub #3).
 *   - SYNC_DRY_RUN              true -> every sync this server runs (cron ticks, the
 *                               dashboard button, SYNC_ON_STARTUP, npm run sync) is a
 *                               dry-run: reads Sage and Fracttal, never writes to Fracttal.
 *                               Empty/false -> writes as usual.
 *
 * Pure on purpose: no logging, no process.exit, and the environment is only read
 * through the parameter. Invalid values are reported in `errors` (Spanish, one
 * per variable) and also kept in their fields, so a caller that forgets to check
 * `errors` fails loudly inside node-cron instead of silently scheduling nothing.
 * Callers (src/main.js, headless src/app.js) print the errors and exit 1 BEFORE
 * any cron.schedule call, because node-cron throws on values such as 'off'.
 */

const cron = require('node-cron');

const DEFAULT_FULL_SCHEDULE = '0 2 * * *';
const DEFAULT_TIMEZONE = 'America/Mexico_City';
const OFF_VALUES = new Set(['off', 'false', 'none', 'disabled']);
const NOT_SCHEDULED = 'sin horario (manual)';
const DRY_RUN_TRUE_VALUES = new Set(['true', '1', 'yes', 'si', 'sí', 'on']);
const DRY_RUN_FALSE_VALUES = new Set(['false', '0', 'no', 'off']);

/** Spanish label per load type, shared by logs and the dashboard description. */
const SYNC_MODE_LABELS = Object.freeze({ full: 'COMPLETA', daily: 'DIARIA (delta)' });

/**
 * @typedef {Object} SyncSchedules
 * @property {string|null} full     cron for the FULL load (syncInventory); null = not scheduled
 * @property {string|null} daily    cron for the DAILY/delta load (syncInventoryMoved); null = not scheduled
 * @property {string} timezone      IANA zone used for every cron.schedule
 * @property {boolean} dryRun       true = this server never writes to Fracttal (SYNC_DRY_RUN)
 * @property {string[]} errors      Spanish, one per invalid variable; non-empty => caller must exit(1)
 */

// Trim and collapse internal whitespace runs: '  0  12 * * * ' -> '0 12 * * *'.
function normalize(raw) {
    return String(raw ?? '').trim().replace(/\s+/g, ' ');
}

function isOffValue(value) {
    return OFF_VALUES.has(value.toLowerCase());
}

// node-cron builds an Intl.DateTimeFormat with the zone, so accept exactly what Intl accepts.
function isValidTimezone(timeZone) {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone });
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * Resolves SYNC_DRY_RUN. An unrecognized value fails safe: `dryRun` is true and
 * `error` explains the variable, so a typo never turns writes on.
 *
 * @param {Object} [env=process.env]
 * @returns {{dryRun: boolean, error: string|null}}
 */
function resolveSyncDryRun(env = process.env) {
    const value = normalize(env.SYNC_DRY_RUN).toLowerCase();
    if (value === '' || DRY_RUN_FALSE_VALUES.has(value)) {
        return { dryRun: false, error: null };
    }
    if (DRY_RUN_TRUE_VALUES.has(value)) {
        return { dryRun: true, error: null };
    }
    return {
        dryRun: true,
        error: `SYNC_DRY_RUN="${normalize(env.SYNC_DRY_RUN)}" no es válido (usa "true" para solo simular sin escribir en Fracttal, o "false" para escribir)`
    };
}

/**
 * Resolves the sync schedules from the environment. Collects ALL errors so the
 * operator sees every bad variable in one boot (same approach as validateEnv).
 *
 * @param {Object} [env=process.env]
 * @returns {SyncSchedules}
 */
function resolveSyncSchedules(env = process.env) {
    const errors = [];

    // FULL load: empty keeps the historical default; an off-value disables it.
    const fullValue = normalize(env.SYNC_CRON_SCHEDULE);
    let full;
    if (fullValue === '') {
        full = DEFAULT_FULL_SCHEDULE;
    } else if (isOffValue(fullValue)) {
        full = null;
    } else {
        full = fullValue;
        if (!cron.validate(fullValue)) {
            errors.push(`SYNC_CRON_SCHEDULE="${fullValue}" no es una expresión cron válida (ej. "0 2 * * *"; usa "off" para no programar la carga completa)`);
        }
    }

    // DAILY/delta load: opt-in. Off-values are accepted too, for symmetry with the full load.
    const dailyValue = normalize(env.SYNC_DAILY_CRON_SCHEDULE);
    let daily;
    if (dailyValue === '' || isOffValue(dailyValue)) {
        daily = null;
    } else {
        daily = dailyValue;
        if (!cron.validate(dailyValue)) {
            errors.push(`SYNC_DAILY_CRON_SCHEDULE="${dailyValue}" no es una expresión cron válida (ej. "0 12,16,23 * * *"; déjala vacía o usa "off" para no programar la carga diaria)`);
        }
    }

    // Timezone: independent of the Windows server's zone.
    const timezoneValue = normalize(env.SYNC_TIMEZONE);
    let timezone;
    if (timezoneValue === '') {
        timezone = DEFAULT_TIMEZONE;
    } else {
        timezone = timezoneValue;
        if (!isValidTimezone(timezoneValue)) {
            errors.push(`SYNC_TIMEZONE="${timezoneValue}" no es una zona horaria IANA válida (ej. "America/Mexico_City")`);
        }
    }

    // Dry-run switch for the whole server (cron ticks, dashboard button, CLI).
    const { dryRun, error: dryRunError } = resolveSyncDryRun(env);
    if (dryRunError) {
        errors.push(dryRunError);
    }

    return { full, daily, timezone, dryRun, errors };
}

/**
 * One-line Spanish description for the boot banner and the dashboard, e.g.
 * 'Completa: sin horario (manual) · Diaria: 0 12,16,23 * * * · Zona: America/Mexico_City'.
 * With SYNC_DRY_RUN=true it ends with ' · Modo: SIMULACIÓN (no escribe en Fracttal)'.
 *
 * @param {SyncSchedules} schedules
 * @returns {string}
 */
function describeSyncSchedules(schedules) {
    const full = schedules.full || NOT_SCHEDULED;
    const daily = schedules.daily || NOT_SCHEDULED;
    const description = `Completa: ${full} · Diaria: ${daily} · Zona: ${schedules.timezone}`;
    return schedules.dryRun ? `${description} · Modo: SIMULACIÓN (no escribe en Fracttal)` : description;
}

module.exports = { resolveSyncSchedules, resolveSyncDryRun, describeSyncSchedules, SYNC_MODE_LABELS };
