const { asyncHandler } = require('../middleware/errorHandler');
const { syncInventory } = require('../app');
const logger = require('../config/logger');

const manualSync = asyncHandler(async (req, res) => {
    const { syncStateManager } = req.app.locals;

    if (syncStateManager.isInProgress()) {
        return res.status(409).json({
            error: 'Sincronización ya en progreso',
            inProgress: true
        });
    }

    try {
        // Ejecutar sincronización en background
        runSyncWithTracking(syncStateManager);

        res.json({
            message: 'Sincronización iniciada',
            inProgress: true
        });
    } catch (error) {
        logger.error('Error iniciando sincronización manual:', error);
        throw error;
    }
});

// Dry-run: ejecuta el flujo de sync sin enviar escrituras a Fracttal.
// Devuelve la clasificación (Case A/B/C), almacenes faltantes y un preview por item.
// Útil ANTES del primer sync en prod cuando el almacén tiene items cargados manualmente.
const previewSync = asyncHandler(async (req, res) => {
    const { syncStateManager } = req.app.locals;

    if (syncStateManager.isInProgress()) {
        return res.status(409).json({
            error: 'Sincronización ya en progreso — espera a que termine antes de pedir un preview',
            inProgress: true
        });
    }

    try {
        logger.info('Iniciando dry-run via HTTP (POST /api/sync/preview)');
        const summary = await syncInventory({ dryRun: true });
        return res.json({
            message: 'Dry-run completado — ninguna escritura enviada a Fracttal',
            summary
        });
    } catch (error) {
        logger.error('Error ejecutando dry-run via HTTP:', error);
        throw error;
    }
});

const getSyncStatus = asyncHandler(async (req, res) => {
    const { syncStateManager } = req.app.locals;
    const state = syncStateManager.getState();
    
    res.json({
        inProgress: state.inProgress,
        stats: state.stats,
        lastResult: state.lastResult,
        history: state.history
    });
});

const getSyncHistory = asyncHandler(async (req, res) => {
    const { syncStateManager } = req.app.locals;
    const { limit = 10 } = req.query;
    
    const history = syncStateManager.getHistory(parseInt(limit));
    
    res.json({
        history,
        total: history.length
    });
});

// Función auxiliar para ejecutar sincronización con tracking
async function runSyncWithTracking(syncStateManager) {
    const startTime = syncStateManager.startSync();
    
    try {
        console.log('\n🔄 Iniciando sincronización...');
        logger.info('Iniciando sincronización');
        
        const result = await syncInventory();
        
        syncStateManager.endSync({ success: true, data: result }, startTime);
        
        console.log('✅ Sincronización completada exitosamente');
        logger.info('Sincronización completada exitosamente');
        
    } catch (error) {
        syncStateManager.endSync({ success: false, error: error.message }, startTime);
        
        console.error('❌ Error en sincronización:', error.message);
        logger.error('Error en sincronización:', error);
        
        throw error;
    }
}

module.exports = {
    manualSync,
    previewSync,
    getSyncStatus,
    getSyncHistory,
    runSyncWithTracking
};
