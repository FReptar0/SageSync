#!/usr/bin/env node

const { validateEnv } = require('./utils/validateEnv');
const { validate: validateLicense } = require('./services/LicenseValidator');
const { syncInventory } = require('./app');
const logger = require('./config/logger');

async function runSync() {
    // Soportar --dry-run para preview sin escribir a Fracttal.
    const dryRun = process.argv.includes('--dry-run') || process.argv.includes('--dryRun');

    logger.info('='.repeat(60));
    logger.info(dryRun
        ? 'INICIANDO DRY-RUN DE SINCRONIZACIÓN (sin escrituras a Fracttal)'
        : 'INICIANDO PROCESO DE SINCRONIZACIÓN MANUAL');
    logger.info('='.repeat(60));

    // ENF-03/LIC-01: Startup license gate -- validates env then license before any sync
    validateEnv();
    await validateLicense({ startup: true });

    try {
        const summary = await syncInventory({ dryRun });
        logger.info('='.repeat(60));
        logger.info(dryRun
            ? 'DRY-RUN COMPLETADO — revisar resumen y preview antes de un sync real'
            : 'SINCRONIZACIÓN COMPLETADA EXITOSAMENTE');
        logger.info('='.repeat(60));
        // En dry-run, imprimir el preview compacto a stdout (los logs ya quedaron en Winston).
        if (dryRun && summary && summary.preview) {
            console.log('\n=== DRY-RUN PREVIEW ===');
            console.log(JSON.stringify({
                totalItems: summary.totalItems,
                processedItems: summary.processedItems,
                errors: summary.errors,
                caseCounts: summary.caseCounts,
                warehousesMissing: summary.warehousesMissing,
                firstItems: summary.preview.slice(0, 5)
            }, null, 2));
            console.log(`(${summary.preview.length} items en el preview completo, mostrando primeros 5)`);
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
