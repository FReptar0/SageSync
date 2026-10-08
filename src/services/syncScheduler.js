'use strict';

/**
 * Sync scheduler for the service process (src/main.js).
 *
 * Registers one node-cron task per enabled load type (full -> syncInventory,
 * daily -> syncInventoryMoved), always with an explicit timezone so the times
 * do not drift with the Windows server's zone (GitHub #3). Every tick
 * re-validates the license (periodic LIC-02 check) and skips when the license
 * is invalid or a sync is already in progress.
 *
 * NEVER require this module from src/app.js: syncController requires app.js,
 * so app -> syncScheduler -> syncController -> app would be a require cycle.
 */

const cron = require('node-cron');
const logger = require('../config/logger');
const { validate, isValid } = require('./LicenseValidator');
const { runSyncWithTracking } = require('../controllers/syncController');
const { SYNC_MODE_LABELS } = require('../config/schedules');

// Registration order: full load first, then daily.
const MODES = ['full', 'daily'];

/**
 * One scheduled tick for a load type. Never rejects: every failure is logged.
 *
 * @param {'full'|'daily'} mode
 * @param {Object} syncStateManager  SyncStateManager instance shared with the dashboard
 * @returns {Promise<void>}
 */
async function runScheduledSync(mode, syncStateManager) {
    const label = SYNC_MODE_LABELS[mode];
    try {
        // LIC-02: periodic re-validation on every tick (no startup flag, never exits)
        await validate();
        if (!isValid()) {
            // Keep this English prefix: /log-tail searches for it.
            logger.warn(`License invalid — skipping scheduled sync (${label})`);
            return;
        }
        if (syncStateManager.isInProgress()) {
            logger.warn(`Sincronización programada ${label} saltada - ya hay una en progreso`);
            return;
        }
        logger.info(`Ejecutando sincronización programada ${label}...`);
        await runSyncWithTracking(syncStateManager, { mode });
    } catch (error) {
        logger.error(`Error en sincronización programada ${label}:`, error);
    }
}

/**
 * Registers one cron per enabled load type, with `{ timezone }`.
 * Expects schedules already resolved and validated (empty `errors`).
 *
 * @param {import('../config/schedules').SyncSchedules} schedules
 * @param {Object} syncStateManager  SyncStateManager instance shared with the dashboard
 * @returns {Array} the node-cron tasks created
 */
function registerSyncSchedules(schedules, syncStateManager) {
    const tasks = [];
    for (const mode of MODES) {
        const label = SYNC_MODE_LABELS[mode];
        const expression = schedules[mode];
        if (!expression) {
            logger.info(`Sincronización ${label}: sin horario programado (solo manual)`);
            continue;
        }
        // The arrow returns the tick's promise (lets tests await a tick).
        const task = cron.schedule(
            expression,
            () => runScheduledSync(mode, syncStateManager),
            { timezone: schedules.timezone }
        );
        logger.info(`Sincronización ${label} programada: "${expression}" (zona ${schedules.timezone})`);
        tasks.push(task);
    }
    return tasks;
}

module.exports = { registerSyncSchedules, runScheduledSync };
