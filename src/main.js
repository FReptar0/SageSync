const express = require('express');
const { syncInventory } = require('./app');
const SageService = require('./services/sageService');
const FracttalClient = require('./services/fracttalClient');
const logger = require('./config/logger');
const path = require('path');
const cron = require('node-cron');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Variables para tracking del estado
let syncInProgress = false;
let lastSyncResult = null;
let syncStats = {
    totalSyncs: 0,
    successfulSyncs: 0,
    failedSyncs: 0,
    lastSyncTime: null
};

// Instancias de servicios
const sage = new SageService();
const fracttal = new FracttalClient();

// Función wrapper para la sincronización con tracking de estado
async function runSyncWithTracking() {
    if (syncInProgress) {
        logger.warn('Sincronización ya en progreso, saltando...');
        return;
    }

    syncInProgress = true;
    const startTime = new Date();
    
    try {
        console.log('\n🔄 Iniciando sincronización programada...');
        logger.info('Iniciando sincronización programada');
        
        const result = await syncInventory();
        
        syncStats.totalSyncs++;
        syncStats.successfulSyncs++;
        syncStats.lastSyncTime = startTime.toISOString();
        lastSyncResult = {
            success: true,
            timestamp: startTime.toISOString(),
            duration: Date.now() - startTime.getTime(),
            ...result
        };
        
        console.log('✅ Sincronización completada exitosamente');
        logger.info('Sincronización programada completada exitosamente');
        
    } catch (error) {
        syncStats.totalSyncs++;
        syncStats.failedSyncs++;
        lastSyncResult = {
            success: false,
            timestamp: startTime.toISOString(),
            duration: Date.now() - startTime.getTime(),
            error: error.message
        };
        
        console.error('❌ Error en sincronización programada:', error.message);
        logger.error('Error en sincronización programada:', error);
        
    } finally {
        syncInProgress = false;
    }
}

// Programar sincronización automática
const cronSchedule = process.env.SYNC_CRON_SCHEDULE || '0 2 * * *';
console.log(`📅 Sincronización programada: ${cronSchedule}`);
cron.schedule(cronSchedule, runSyncWithTracking);

// Rutas de la API

// Dashboard principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Estado del sistema
app.get('/api/status', async (req, res) => {
    try {
        const sageConnected = await sage.validateConnection();
        const fracttalToken = await fracttal.getAccessToken();
        
        // Verificar estado de módulos de Fracttal
        let fracttalModules = {
            warehouses: false,
            inventories: false,
            items: false
        };
        
        try {
            await fracttal.getAllWarehouses();
            fracttalModules.warehouses = true;
        } catch (error) {
            if (error.isUnauthorizedEndpoint) {
                fracttalModules.warehouses = 'UNAUTHORIZED_ENDPOINT';
            }
        }
        
        try {
            await fracttal.getAllInventories();
            fracttalModules.inventories = true;
        } catch (error) {
            if (error.isUnauthorizedEndpoint) {
                fracttalModules.inventories = 'UNAUTHORIZED_ENDPOINT';
            }
        }
        
        res.json({
            status: 'running',
            sage: {
                connected: sageConnected,
                database: process.env.DB_DATABASE
            },
            fracttal: {
                authenticated: !!fracttalToken,
                baseUrl: process.env.FRACTTAL_BASE_URL,
                modules: fracttalModules
            },
            sync: {
                inProgress: syncInProgress,
                stats: syncStats,
                lastResult: lastSyncResult,
                schedule: cronSchedule
            },
            uptime: process.uptime(),
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Error obteniendo status:', error);
        res.status(500).json({ error: 'Error obteniendo status del sistema' });
    }
});

// Estadísticas de inventario de Sage300
app.get('/api/sage/stats', async (req, res) => {
    try {
        const stats = await sage.getInventoryStats();
        const locations = await sage.getUniqueLocations();
        
        res.json({
            ...stats,
            locations: locations.length,
            locationList: locations
        });
    } catch (error) {
        logger.error('Error obteniendo estadísticas de Sage:', error);
        res.status(500).json({ error: 'Error obteniendo estadísticas de Sage300' });
    }
});

// Sincronización manual
app.post('/api/sync', async (req, res) => {
    if (syncInProgress) {
        return res.status(409).json({ 
            error: 'Sincronización ya en progreso',
            inProgress: true 
        });
    }

    try {
        // Ejecutar sincronización en background
        runSyncWithTracking();
        
        res.json({ 
            message: 'Sincronización iniciada',
            inProgress: true 
        });
    } catch (error) {
        logger.error('Error iniciando sincronización manual:', error);
        res.status(500).json({ error: 'Error iniciando sincronización' });
    }
});

// Probar conexiones
app.get('/api/test/connections', async (req, res) => {
    try {
        const results = {
            sage: { connected: false, status: '', error: null },
            fracttal: { authenticated: false, status: '', error: null }
        };

        // Probar Sage300
        try {
            results.sage.connected = await sage.validateConnection();
            results.sage.status = results.sage.connected ? 'Conectado' : 'Desconectado';
        } catch (sageError) {
            results.sage.error = sageError.message;
            results.sage.status = 'Error de conexión';
        }

        // Probar Fracttal
        try {
            const token = await fracttal.getAccessToken();
            results.fracttal.authenticated = !!token;
            results.fracttal.status = results.fracttal.authenticated ? 'Autenticado' : 'No autenticado';
        } catch (fracttalError) {
            results.fracttal.error = fracttalError.message;
            results.fracttal.status = 'Error de autenticación';
        }

        res.json(results);
    } catch (error) {
        logger.error('Error probando conexiones:', error);
        res.status(500).json({ error: 'Error probando conexiones' });
    }
});

// Items de inventario por ubicación
app.get('/api/sage/inventory/:location?', async (req, res) => {
    try {
        const { location } = req.params;
        const { limit = 50, offset = 0 } = req.query;
        
        let items;
        if (location) {
            items = await sage.getInventoryItemsByLocation(location);
        } else {
            items = await sage.getAllInventoryItems();
        }
        
        // Paginación simple
        const startIndex = parseInt(offset);
        const limitNum = parseInt(limit);
        const paginatedItems = items.slice(startIndex, startIndex + limitNum);
        
        res.json({
            items: paginatedItems,
            total: items.length,
            offset: startIndex,
            limit: limitNum,
            hasMore: startIndex + limitNum < items.length
        });
    } catch (error) {
        logger.error('Error obteniendo items de inventario:', error);
        res.status(500).json({ error: 'Error obteniendo items de inventario' });
    }
});

// Información de almacenes de Fracttal
app.get('/api/fracttal/warehouses', async (req, res) => {
    try {
        const warehouses = await fracttal.getWarehouses();
        res.json(warehouses);
    } catch (error) {
        logger.error('Error obteniendo almacenes de Fracttal:', error);
        res.status(500).json({ error: 'Error obteniendo almacenes de Fracttal' });
    }
});

// Manejo de errores global
app.use((error, req, res, next) => {
    logger.error('Error no manejado en la aplicación:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
});

// Iniciar servidor
app.listen(port, () => {
    console.log('\n' + '='.repeat(60));
    console.log('🚀 SageSync Server iniciado exitosamente!');
    console.log(`📍 Dashboard disponible en: http://localhost:${port}`);
    console.log(`📅 Sincronización programada: ${cronSchedule}`);
    console.log('='.repeat(60));
    
    logger.info(`SageSync Server iniciado en puerto ${port}`);
    
    // Ejecutar una sincronización inicial si está habilitada
    if (process.env.SYNC_ON_STARTUP === 'true') {
        console.log('\n🔄 Ejecutando sincronización inicial...');
        setTimeout(runSyncWithTracking, 5000); // Dar tiempo para que se inicialice todo
    }
});

// Manejo de cierre graceful
process.on('SIGINT', () => {
    console.log('\n👋 Cerrando SageSync Server...');
    logger.info('SageSync Server cerrando...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n👋 Cerrando SageSync Server...');
    logger.info('SageSync Server cerrando...');
    process.exit(0);
});

module.exports = app;
