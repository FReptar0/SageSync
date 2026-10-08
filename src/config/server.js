require('dotenv').config();
const { resolveSyncSchedules } = require('./schedules');

module.exports = {
    port: process.env.PORT || 3000,
    syncSchedules: resolveSyncSchedules(process.env),
    syncOnStartup: process.env.SYNC_ON_STARTUP === 'true',
    logs: {
        maxLines: parseInt(process.env.LOG_MAX_LINES) || 10000,
        updateInterval: parseInt(process.env.LOG_UPDATE_INTERVAL) || 60000,
        directory: process.env.LOG_DIRECTORY || '../logs'
    },
    pagination: {
        defaultLimit: parseInt(process.env.DEFAULT_PAGINATION_LIMIT) || 50,
        maxLimit: parseInt(process.env.MAX_PAGINATION_LIMIT) || 500
    }
};
