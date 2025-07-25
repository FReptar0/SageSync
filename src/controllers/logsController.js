const { asyncHandler } = require('../middleware/errorHandler');
const LogParser = require('../utils/logParser');
const path = require('path');
const config = require('../config/server');

const getLogs = asyncHandler(async (req, res) => {
    const { lines = 100, type = 'all' } = req.query;
    
    // Validación
    if (isNaN(lines) || lines < 1 || lines > config.logs.maxLines) {
        return res.status(400).json({ 
            error: `Parámetro lines debe estar entre 1 y ${config.logs.maxLines}` 
        });
    }
    
    if (!['all', 'app', 'error'].includes(type)) {
        return res.status(400).json({ 
            error: 'Tipo de log debe ser: all, app o error' 
        });
    }
    
    const logsDir = path.join(__dirname, config.logs.directory);
    const logParser = new LogParser(logsDir);
    
    const logs = await logParser.readLogs(type, parseInt(lines));
    
    res.json({
        logs,
        totalLines: logs.length,
        requestedLines: parseInt(lines),
        logType: type,
        timestamp: new Date().toISOString()
    });
});

const getLogStats = asyncHandler(async (req, res) => {
    const logsDir = path.join(__dirname, config.logs.directory);
    const logParser = new LogParser(logsDir);
    
    const stats = await logParser.getLogStats();
    
    res.json({
        stats,
        timestamp: new Date().toISOString()
    });
});

module.exports = {
    getLogs,
    getLogStats
};
