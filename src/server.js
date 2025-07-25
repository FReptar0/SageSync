const express = require('express');
const { syncInventory } = require('./app');
const SageService = require('./services/sageService');
const FracttalClient = require('./services/fracttalClient');
const logger = require('./config/logger');
const path = require('path');
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
                database: process.env.DB_NAME
            },
            fracttal: {
                authenticated: !!fracttalToken,
                baseUrl: process.env.FRACTTAL_BASE_URL,
                modules: fracttalModules
            },
            sync: {
                inProgress: syncInProgress,
                stats: syncStats,
                lastResult: lastSyncResult
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

// Ejecutar sincronización manual
app.post('/api/sync', async (req, res) => {
    if (syncInProgress) {
        return res.status(409).json({ error: 'Sincronización ya en progreso' });
    }
    
    syncInProgress = true;
    syncStats.totalSyncs++;
    
    try {
        logger.info('Iniciando sincronización manual...');
        await syncInventory();
        
        syncStats.successfulSyncs++;
        syncStats.lastSyncTime = new Date().toISOString();
        lastSyncResult = {
            success: true,
            timestamp: new Date().toISOString(),
            message: 'Sincronización completada exitosamente'
        };
        
        res.json(lastSyncResult);
    } catch (error) {
        syncStats.failedSyncs++;
        lastSyncResult = {
            success: false,
            timestamp: new Date().toISOString(),
            error: error.message
        };
        
        logger.error('Error en sincronización manual:', error);
        res.status(500).json(lastSyncResult);
    } finally {
        syncInProgress = false;
    }
});

// Test de conexiones
app.get('/api/test/connections', async (req, res) => {
    try {
        const results = {
            sage: {
                status: 'testing...',
                connected: false,
                error: null
            },
            fracttal: {
                status: 'testing...',
                authenticated: false,
                error: null
            }
        };
        
        // Test Sage300
        try {
            results.sage.connected = await sage.validateConnection();
            results.sage.status = results.sage.connected ? 'connected' : 'failed';
        } catch (error) {
            results.sage.status = 'error';
            results.sage.error = error.message;
        }
        
        // Test Fracttal
        try {
            const token = await fracttal.getAccessToken();
            results.fracttal.authenticated = !!token;
            results.fracttal.status = results.fracttal.authenticated ? 'authenticated' : 'failed';
        } catch (error) {
            results.fracttal.status = 'error';
            results.fracttal.error = error.message;
        }
        
        res.json(results);
    } catch (error) {
        logger.error('Error en test de conexiones:', error);
        res.status(500).json({ error: 'Error ejecutando test de conexiones' });
    }
});

// Logs recientes
app.get('/api/logs', (req, res) => {
    // Esta sería una implementación básica
    // En producción podrías leer los archivos de log
    res.json({
        message: 'Endpoint de logs no implementado',
        logFile: process.env.LOG_FILE
    });
});

// Middleware de manejo de errores
app.use((error, req, res, next) => {
    logger.error('Error no manejado:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
});

// Iniciar servidor
app.listen(port, () => {
    logger.info(`Servidor SageSync iniciado en puerto ${port}`);
    console.log(`🚀 SageSync Server running on http://localhost:${port}`);
});

module.exports = app;
