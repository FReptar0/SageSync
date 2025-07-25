const { asyncHandler } = require('../middleware/errorHandler');
const LogParser = require('../utils/logParser');
const path = require('path');
const config = require('../config/server');

const getLogs = asyncHandler(async (req, res) => {
    const { lines = 100, type = 'all', fromDate, toDate, date } = req.query;
    
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
    
    const logsDir = path.join(__dirname, '../../logs'); // Corregir la ruta
    const logParser = new LogParser(logsDir);
    
    console.log(`DEBUG: Buscando logs en: ${logsDir}`); // Debug log
    
    let logs;
    if (date) {
        // Obtener logs de una fecha específica
        logs = await logParser.getLogsByDate(date, type);
    } else {
        // Obtener logs con rango de fechas opcional
        logs = await logParser.readLogs(type, parseInt(lines), fromDate, toDate);
    }
    
    console.log(`DEBUG: Encontrados ${logs.length} logs`); // Debug log
    
    res.json({
        logs,
        totalLines: logs.length,
        requestedLines: parseInt(lines),
        logType: type,
        dateFilter: date || null,
        timestamp: new Date().toISOString()
    });
});

const getAvailableDates = asyncHandler(async (req, res) => {
    const { type = 'all' } = req.query;
    
    const logsDir = path.join(__dirname, '../../logs'); // Corregir la ruta
    const logParser = new LogParser(logsDir);
    
    const dates = await logParser.getAvailableDates(type);
    
    res.json({
        dates,
        total: dates.length,
        timestamp: new Date().toISOString()
    });
});

const getLogStats = asyncHandler(async (req, res) => {
    const logsDir = path.join(__dirname, '../../logs'); // Corregir la ruta
    const logParser = new LogParser(logsDir);
    
    const stats = await logParser.getLogStats();
    
    res.json({
        stats,
        timestamp: new Date().toISOString()
    });
});

const testLogs = asyncHandler(async (req, res) => {
    const fs = require('fs');
    const logsDir = path.join(__dirname, '../../logs');
    
    const testInfo = {
        logsDirectory: logsDir,
        directoryExists: fs.existsSync(logsDir),
        files: []
    };
    
    if (testInfo.directoryExists) {
        const files = fs.readdirSync(logsDir);
        testInfo.files = files.map(file => {
            const filePath = path.join(logsDir, file);
            const stats = fs.statSync(filePath);
            return {
                name: file,
                size: stats.size,
                modified: stats.mtime.toISOString(),
                exists: fs.existsSync(filePath)
            };
        });
    }
    
    // Test reading a few lines
    const logParser = new LogParser(logsDir);
    let testLogs = [];
    try {
        testLogs = await logParser.readLogs('all', 5);
    } catch (error) {
        testInfo.readError = error.message;
    }
    
    res.json({
        testInfo,
        sampleLogs: testLogs,
        timestamp: new Date().toISOString()
    });
});

module.exports = {
    getLogs,
    getLogStats,
    getAvailableDates,
    testLogs
};
