#!/usr/bin/env node

const { validateEnv } = require('./utils/validateEnv');
const { validate: validateLicense } = require('./services/LicenseValidator');
const { syncInventory, syncInventoryMoved } = require('./app');
const { resolveSyncDryRun } = require('./config/schedules');
const logger = require('./config/logger');

async function runSync() {
    // SYNC_DRY_RUN=true en el .env: este servidor solo simula, también desde la consola.
    // Un valor inválido aborta antes de tocar Sage o Fracttal (mismo criterio que main.js).
    const envDryRun = resolveSyncDryRun(process.env);
    if (envDryRun.error) {
        console.error('[CONFIG ERROR] ' + envDryRun.error);
        console.error('Corrige el .env y vuelve a correr el comando.');
        process.exit(1);
    }
    // Soportar --dry-run para preview sin escribir a Fracttal.
    const dryRun = envDryRun.dryRun || process.argv.includes('--dry-run') || process.argv.includes('--dryRun');
    // Soportar --moved (alias --daily): corre la CARGA DIARIA/delta (solo lo que se
    // movió) en lugar de la CARGA INICIAL (todo). Ver src/app.js → syncInventoryMoved.
    const moved = process.argv.includes('--moved') || process.argv.includes('--daily');
    const runFn = moved ? syncInventoryMoved : syncInventory;
    const modeLabel = moved ? 'DIARIA (delta)' : 'INICIAL (completa)';

    logger.info('='.repeat(60));
    logger.info(dryRun
        ? `INICIANDO DRY-RUN DE SINCRONIZACIÓN ${modeLabel} (sin escrituras a Fracttal)`
        : `INICIANDO PROCESO DE SINCRONIZACIÓN ${modeLabel} MANUAL`);
    if (envDryRun.dryRun) {
        logger.warn('SYNC_DRY_RUN=true en el .env: este servidor solo simula. Para escribir en Fracttal cámbialo a false.');
    }
    logger.info('='.repeat(60));

    // ENF-03/LIC-01: Startup license gate -- validates env then license before any sync
    validateEnv();
    await validateLicense({ startup: true });

    try {
        const summary = await runFn({ dryRun });
        logger.info('='.repeat(60));
        logger.info(dryRun
            ? 'DRY-RUN COMPLETADO — revisar resumen y preview antes de un sync real'
            : 'SINCRONIZACIÓN COMPLETADA EXITOSAMENTE');
        logger.info('='.repeat(60));
        // Tabla de lo procesado (aplica tanto a dry-run como a sync real).
        if (summary && Array.isArray(summary.preview) && summary.preview.length > 0) {
            const { renderProcessedTable } = require('./utils/summaryTable');
            console.log('\n' + (dryRun ? 'PREVIEW — items que se sincronizarian:' : 'Items sincronizados:'));
            console.log(renderProcessedTable(summary.preview));
            console.log(
                `\nTotal: ${summary.processedItems} procesados  |  ` +
                `Case A: ${summary.caseCounts.caseA}  B: ${summary.caseCounts.caseB}  C: ${summary.caseCounts.caseC}  |  ` +
                `Errores: ${summary.errors}`
            );
            if (summary.warehousesMissing && summary.warehousesMissing.length > 0) {
                console.log(`Almacenes faltantes (se crearian en modo real): ${summary.warehousesMissing.join(', ')}`);
            }
        }
        process.exit(0);
    } catch (error) {
        logger.error('='.repeat(60));
        logger.error(dryRun ? 'ERROR EN EL DRY-RUN:' : 'ERROR EN LA SINCRONIZACIÓN:', error);
        logger.error('='.repeat(60));
        process.exit(1);
    }
}

// Ejecutar si es llamado directamente
if (require.main === module) {
    runSync();
}

// Exportado solo para tests
module.exports = { runSync };
