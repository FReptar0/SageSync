const { asyncHandler } = require('../middleware/errorHandler');
const { syncInventory, syncInventoryMoved } = require('../app');
const { SYNC_MODE_LABELS, resolveSyncDryRun } = require('../config/schedules');
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
        // Ejecutar sincronización en background (carga COMPLETA manual).
        // El error ya queda en el log y en el historial dentro de runSyncWithTracking;
        // el .catch evita un unhandledRejection que tumbaría el servicio (Node 18).
        runSyncWithTracking(syncStateManager).catch(() => {});

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

// Función auxiliar para ejecutar sincronización con tracking.
// mode 'full' (default) = carga COMPLETA (syncInventory): botón del dashboard y SYNC_ON_STARTUP.
// mode 'daily' = carga DIARIA/delta (syncInventoryMoved): cron programado (syncScheduler).
// Con SYNC_DRY_RUN=true en el .env toda corrida es simulación: lee Sage y Fracttal,
// nunca escribe en Fracttal. Un valor inválido también simula (main.js ya no arranca con él).
async function runSyncWithTracking(syncStateManager, { mode = 'full' } = {}) {
    const syncMode = mode === 'daily' ? 'daily' : 'full';
    const { dryRun } = resolveSyncDryRun(process.env);
    const label = dryRun
        ? `${SYNC_MODE_LABELS[syncMode]} en modo SIMULACIÓN (SYNC_DRY_RUN=true, no escribe en Fracttal)`
        : SYNC_MODE_LABELS[syncMode];
    const startTime = syncStateManager.startSync();

    try {
        console.log(`\n🔄 Iniciando sincronización ${label}...`);
        logger.info(`Iniciando sincronización ${label}`);

        const result = syncMode === 'daily'
            ? await syncInventoryMoved({ dryRun })
            : await syncInventory({ dryRun });
        
        syncStateManager.endSync({ success: true, data: result, mode: syncMode }, startTime);
        
        console.log(`✅ Sincronización ${label} completada exitosamente`);
        logger.info(`Sincronización ${label} completada exitosamente`);
        
    } catch (error) {
        syncStateManager.endSync({ success: false, error: error.message, mode: syncMode }, startTime);
        
        console.error(`❌ Error en sincronización ${label}:`, error.message);
        logger.error(`Error en sincronización ${label}:`, error);
        
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
