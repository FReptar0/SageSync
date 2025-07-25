const express = require('express');
const path = require('path');
const cron = require('node-cron');

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

const app = express();

// Middleware básico
app.use(express.json());
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
console.log(`📅 Sincronización programada: ${config.syncSchedule}`);
cron.schedule(config.syncSchedule, async () => {
    try {
        if (!syncStateManager.isInProgress()) {
            console.log('\n🔄 Ejecutando sincronización programada...');
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
    console.log('🚀 SageSync Server iniciado exitosamente!');
    console.log(`📍 Dashboard disponible en: http://localhost:${config.port}`);
    console.log(`📅 Sincronización programada: ${config.syncSchedule}`);
    console.log('='.repeat(60));
    
    logger.info(`SageSync Server iniciado en puerto ${config.port}`);
    
    // Ejecutar sincronización inicial si está habilitada
    if (config.syncOnStartup) {
        console.log('\n🔄 Ejecutando sincronización inicial...');
        setTimeout(async () => {
            try {
                await runSyncWithTracking(syncStateManager);
            } catch (error) {
                logger.error('Error en sincronización inicial:', error);
            }
        }, 5000);
    }
});

// Manejo de cierre graceful
const gracefulShutdown = (signal) => {
    console.log(`\n👋 Cerrando SageSync Server (${signal})...`);
    logger.info(`SageSync Server cerrando por señal ${signal}`);
    
    // Aquí podrías agregar lógica adicional de limpieza
    // como cerrar conexiones de base de datos, finalizar sincronizaciones, etc.
    
    process.exit(0);
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

module.exports = app;
