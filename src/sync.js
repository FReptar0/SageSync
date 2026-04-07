#!/usr/bin/env node

const { validateEnv } = require('./utils/validateEnv');
const { validate: validateLicense } = require('./services/LicenseValidator');
const { syncInventory } = require('./app');
const logger = require('./config/logger');

async function runSync() {
    logger.info('='.repeat(60));
    logger.info('INICIANDO PROCESO DE SINCRONIZACIÓN MANUAL');
    logger.info('='.repeat(60));

    // ENF-03/LIC-01: Startup license gate -- validates env then license before any sync
    validateEnv();
    await validateLicense({ startup: true });

    try {
        await syncInventory();
        logger.info('='.repeat(60));
        logger.info('SINCRONIZACIÓN COMPLETADA EXITOSAMENTE');
        logger.info('='.repeat(60));
        process.exit(0);
    } catch (error) {
        logger.error('='.repeat(60));
        logger.error('ERROR EN LA SINCRONIZACIÓN:', error);
        logger.error('='.repeat(60));
        process.exit(1);
    }
}

// Ejecutar si es llamado directamente
if (require.main === module) {
    runSync();
}
