const { asyncHandler } = require('../middleware/errorHandler');
const LogParser = require('../utils/logParser');
const path = require('path');
const config = require('../config/server');

const getLogs = asyncHandler(async (req, res) => {
    const { lines = 100, type = 'all', fromDate, toDate, date } = req.query;
    
    // Validación mejorada
    const maxLines = config.logs?.maxLines || 10000;
    const parsedLines = parseInt(lines);
    
    if (isNaN(parsedLines) || parsedLines < 1 || parsedLines > maxLines) {
        return res.status(400).json({ 
            error: `Parámetro lines debe estar entre 1 y ${maxLines}. Recibido: ${lines}` 
        });
    }
    
    if (!['all', 'app', 'error'].includes(type)) {
        return res.status(400).json({ 
            error: `Tipo de log debe ser: all, app o error. Recibido: ${type}` 
        });
    }
    
    // Validar formato de fecha si se proporciona
    if (date && !isValidDate(date)) {
        return res.status(400).json({ 
            error: `Formato de fecha inválido. Esperado: YYYY-MM-DD. Recibido: ${date}` 
        });
    }
    
    if (fromDate && !isValidDate(fromDate)) {
        return res.status(400).json({ 
            error: `Formato de fromDate inválido. Esperado: YYYY-MM-DD. Recibido: ${fromDate}` 
        });
    }
    
    if (toDate && !isValidDate(toDate)) {
        return res.status(400).json({ 
            error: `Formato de toDate inválido. Esperado: YYYY-MM-DD. Recibido: ${toDate}` 
        });
    }
    
    const logsDir = path.join(__dirname, '../../logs');
    const logParser = new LogParser(logsDir);
    
    console.log(`DEBUG: Buscando logs - type: ${type}, lines: ${parsedLines}, date: ${date}, fromDate: ${fromDate}, toDate: ${toDate}`);
    
    let logs;
    try {
        if (date) {
            // Obtener logs de una fecha específica
            logs = await logParser.getLogsByDate(date, type);
        } else {
            // Obtener logs con rango de fechas opcional
            logs = await logParser.readLogs(type, parsedLines, fromDate, toDate);
        }
    } catch (error) {
        console.error('Error obteniendo logs:', error);
        return res.status(500).json({ 
            error: `Error interno obteniendo logs: ${error.message}` 
        });
    }
    
    console.log(`DEBUG: Encontrados ${logs?.length || 0} logs`);
    
    res.json({
        logs: logs || [],
        totalLines: logs?.length || 0,
        requestedLines: parsedLines,
        logType: type,
        dateFilter: date || null,
        dateRange: { fromDate, toDate },
        timestamp: new Date().toISOString()
    });
});

// Función auxiliar para validar fechas
function isValidDate(dateString) {
    if (!dateString) return false;
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!regex.test(dateString)) return false;
    const date = new Date(dateString + 'T00:00:00.000Z');
    return !isNaN(date.getTime());
}

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
