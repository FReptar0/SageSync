const express = require('express');
const path = require('path');

// License gate -- must run before any service initialization
const { validateEnv } = require('./utils/validateEnv');
const { validate: validateLicense } = require('./services/LicenseValidator');

// Configuración y servicios
const config = require('./config/server');
const { describeSyncSchedules } = require('./config/schedules');
const logger = require('./config/logger');
const SageService = require('./services/sageService');
const FracttalClient = require('./services/fracttalClient');
const SyncStateManager = require('./services/syncStateManager');
const { registerSyncSchedules } = require('./services/syncScheduler');

// Rutas y middleware
const apiRoutes = require('./routes');
const { errorHandler } = require('./middleware/errorHandler');
const { runSyncWithTracking } = require('./controllers/syncController');

// Validate environment variables first (exits on missing vars)
validateEnv();

// Horarios inválidos (SYNC_CRON_SCHEDULE, SYNC_DAILY_CRON_SCHEDULE, SYNC_TIMEZONE) o
// SYNC_DRY_RUN inválido: abortar aquí, antes del gate de licencia y de cualquier
// cron.schedule (node-cron lanza excepción con valores como "off"). console.error igual
// que validateEnv: el transporte de archivo de winston puede no escribir antes del exit,
// y bajo Servy stderr queda en logs/servy-stderr.log.
if (config.syncSchedules.errors.length > 0) {
    console.error('[CONFIG ERROR] Configuración de sincronización inválida:');
    for (const error of config.syncSchedules.errors) {
        console.error('  - ' + error);
    }
    console.error('Corrige el .env y reinicia el servicio.');
    process.exit(1);
}

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
    // Descripción de una línea de los horarios; el dashboard la muestra como sync.schedule
    const scheduleDescription = describeSyncSchedules(config.syncSchedules);
    app.locals.cronSchedule = scheduleDescription;

    // Programar sincronización automática: un cron por tipo de carga habilitado
    // (COMPLETA / DIARIA delta), con zona horaria explícita (SYNC_TIMEZONE).
    // Cada tick revalida la licencia (LIC-02) y se salta si ya hay una en progreso.
    console.log(`Sincronización programada: ${scheduleDescription}`);
    if (config.syncSchedules.dryRun) {
        logger.warn('MODO SIMULACIÓN (SYNC_DRY_RUN=true): ninguna sincronización de este servidor escribe en Fracttal');
    }
    registerSyncSchedules(config.syncSchedules, syncStateManager);

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
        console.log(`Sincronización programada: ${scheduleDescription}`);
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
