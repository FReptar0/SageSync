const express = require('express');
const path = require('path');
const cron = require('node-cron');

// License gate -- must run before any service initialization
const { validateEnv } = require('./utils/validateEnv');
const { validate: validateLicense, isValid } = require('./services/LicenseValidator');

// Configuración y servicios
const config = require('./config/server');
const logger = require('./config/logger');
const SageService = require('./services/sageService');
const FracttalClient = require('./services/fracttalClient');
const SyncStateManager = require('./services/syncStateManager');

// Rutas y middleware
const apiRoutes = require('./routes');
const { errorHandler } = require('./middleware/errorHandler');
const { runSyncWithTracking } = require('./controllers/syncController');

// Validate environment variables first (exits on missing vars)
validateEnv();

let app;

async function startServer() {
    // LIC-01 + ENF-03: Startup license gate with retry + exit logic
    await validateLicense({ startup: true });

    app = express();

    // Middleware básico
    app.use(express.json());

    // ENF-01: License enforcement — block all requests when license invalid
    // Mounted BEFORE express.static so that static HTML serving is also gated
    // Exempt /api/system/license so the status endpoint is always accessible
    const { requireLicense } = require('./middleware/requireLicense');
    app.use((req, res, next) => {
        if (req.path === '/api/system/license') return next();
        requireLicense(req, res, next);
    });

    app.use(express.static(path.join(__dirname, '../public')));

    // Inicializar servicios
    const sage = new SageService();
    const fracttal = new FracttalClient();
    const syncStateManager = new SyncStateManager();

    // Hacer servicios disponibles globalmente en la app
    app.locals.sage = sage;
    app.locals.fracttal = fracttal;
    app.locals.syncStateManager = syncStateManager;
    app.locals.cronSchedule = config.syncSchedule;

    // Programar sincronización automática
    console.log(`Sincronización programada: ${config.syncSchedule}`);
    cron.schedule(config.syncSchedule, async () => {
        try {
            // LIC-02: Re-validate license on each cron cycle (periodic, no startup flag)
            await validateLicense();
            if (!isValid()) {
                logger.warn('License invalid — skipping scheduled sync');
                return;
            }
            if (!syncStateManager.isInProgress()) {
                console.log('\nEjecutando sincronización programada...');
                await runSyncWithTracking(syncStateManager);
            } else {
                logger.warn('Sincronización programada saltada - ya hay una en progreso');
            }
        } catch (error) {
            logger.error('Error en sincronización programada:', error);
        }
    });

    // Rutas principales
    app.get('/', (req, res) => {
        res.sendFile(path.join(__dirname, '../public/index.html'));
    });

    // Montar rutas de la API
    app.use('/api', apiRoutes);

    // Middleware de manejo de errores (debe ir al final)
    app.use(errorHandler);

    // Iniciar servidor
    app.listen(config.port, () => {
        console.log('\n' + '='.repeat(60));
        console.log('SageSync Server iniciado exitosamente!');
        console.log(`Dashboard disponible en: http://localhost:${config.port}`);
        console.log(`Sincronización programada: ${config.syncSchedule}`);
        console.log('='.repeat(60));

        logger.info(`SageSync Server iniciado en puerto ${config.port}`);

        // Ejecutar sincronización inicial si está habilitada
        if (config.syncOnStartup) {
            console.log('\nEjecutando sincronización inicial...');
            setTimeout(async () => {
                try {
                    await runSyncWithTracking(syncStateManager);
                } catch (error) {
                    logger.error('Error en sincronización inicial:', error);
                }
            }, 5000);
        }
    });
}

// Manejo de cierre graceful
const gracefulShutdown = (signal) => {
    console.log(`\nCerrando SageSync Server (${signal})...`);
    logger.info(`SageSync Server cerrando por señal ${signal}`);
    process.exit(0);
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

startServer().catch((err) => {
    const log = require('./config/logger');
    log.error('Fatal startup error:', err);
    process.exit(1);
});

module.exports = { startServer };
