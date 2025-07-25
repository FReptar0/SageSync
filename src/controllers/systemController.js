const { asyncHandler } = require('../middleware/errorHandler');
const config = require('../config/server');

const getSystemStatus = asyncHandler(async (req, res) => {
    const { sage, fracttal, syncStateManager, cronSchedule } = req.app.locals;
    
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
    
    const syncState = syncStateManager.getState();
    
    res.json({
        status: 'running',
        sage: {
            connected: sageConnected,
            database: process.env.DB_NAME || 'N/A'
        },
        fracttal: {
            authenticated: !!fracttalToken,
            baseUrl: process.env.FRACTTAL_BASE_URL,
            modules: fracttalModules
        },
        sync: {
            inProgress: syncState.inProgress,
            stats: syncState.stats,
            lastResult: syncState.lastResult,
            schedule: cronSchedule
        },
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

const testConnections = asyncHandler(async (req, res) => {
    const { sage, fracttal } = req.app.locals;
    
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
});

module.exports = {
    getSystemStatus,
    testConnections
};
