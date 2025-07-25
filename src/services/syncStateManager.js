const logger = require('../config/logger');

class SyncStateManager {
    constructor() {
        this.state = {
            inProgress: false,
            stats: {
                totalSyncs: 0,
                successfulSyncs: 0,
                failedSyncs: 0,
                lastSyncTime: null
            },
            lastResult: null,
            history: []
        };
    }

    isInProgress() {
        return this.state.inProgress;
    }

    startSync() {
        if (this.state.inProgress) {
            throw new Error('Sincronización ya en progreso');
        }
        
        this.state.inProgress = true;
        logger.info('Estado de sincronización: INICIADA');
        return new Date();
    }

    endSync(result, startTime) {
        this.state.inProgress = false;
        this.state.stats.totalSyncs++;
        
        const duration = Date.now() - startTime.getTime();
        const syncResult = {
            success: result.success,
            timestamp: startTime.toISOString(),
            duration: duration,
            ...(result.success ? result.data : { error: result.error })
        };

        if (result.success) {
            this.state.stats.successfulSyncs++;
            logger.info('Estado de sincronización: COMPLETADA EXITOSAMENTE');
        } else {
            this.state.stats.failedSyncs++;
            logger.error('Estado de sincronización: FALLÓ', result.error);
        }

        this.state.stats.lastSyncTime = startTime.toISOString();
        this.state.lastResult = syncResult;
        
        // Mantener historial de últimas 10 sincronizaciones
        this.state.history.unshift(syncResult);
        if (this.state.history.length > 10) {
            this.state.history = this.state.history.slice(0, 10);
        }

        return syncResult;
    }

    getState() {
        return {
            ...this.state,
            history: [...this.state.history] // Copia para evitar mutaciones
        };
    }

    getStats() {
        return { ...this.state.stats };
    }

    getLastResult() {
        return this.state.lastResult ? { ...this.state.lastResult } : null;
    }

    getHistory(limit = 10) {
        return this.state.history.slice(0, limit);
    }
}

module.exports = SyncStateManager;
