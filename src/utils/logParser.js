const fs = require('fs');
const path = require('path');

class LogParser {
    constructor(logsDirectory) {
        this.logsDirectory = logsDirectory;
    }

    extractTimestamp(logLine) {
        // Primero intentar parsear como JSON
        try {
            const logObj = JSON.parse(logLine);
            if (logObj.timestamp) {
                return logObj.timestamp;
            }
        } catch (e) {
            // Si no es JSON, usar regex patterns
        }
        
        // Múltiples formatos de timestamp para logs de texto plano
        const timestampRegexes = [
            /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/, // ISO format
            /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/, // Standard format
            /\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]/, // Bracketed format
            /\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}/ // US format
        ];
        
        for (const regex of timestampRegexes) {
            const match = logLine.match(regex);
            if (match) {
                return match[0].replace(/[\[\]]/g, ''); // Remove brackets if present
            }
        }
        
        // Si no encuentra timestamp, usar el momento actual
        return new Date().toISOString();
    }

    extractLogLevel(logLine) {
        // Primero intentar parsear como JSON
        try {
            const logObj = JSON.parse(logLine);
            if (logObj.level) {
                return logObj.level.toLowerCase();
            }
        } catch (e) {
            // Si no es JSON, usar detección de texto
        }
        
        const lowerContent = logLine.toLowerCase();
        if (lowerContent.includes('error') || lowerContent.includes('❌') || lowerContent.includes('failed') || lowerContent.includes('unauthorized')) {
            return 'error';
        } else if (lowerContent.includes('warn') || lowerContent.includes('⚠️') || lowerContent.includes('warning')) {
            return 'warn';
        } else if (lowerContent.includes('info') || lowerContent.includes('✅') || lowerContent.includes('success') || lowerContent.includes('completed')) {
            return 'info';
        } else if (lowerContent.includes('debug') || lowerContent.includes('🔍')) {
            return 'debug';
        }
        return 'default';
    }

    extractLogMessage(logLine) {
        // Intentar parsear como JSON primero
        try {
            const logObj = JSON.parse(logLine);
            let message = logObj.message || '';
            
            // Agregar información adicional si existe
            if (logObj.endpoint) {
                message += ` [${logObj.method?.toUpperCase() || 'GET'} ${logObj.endpoint}]`;
            }
            if (logObj.service) {
                message += ` (${logObj.service})`;
            }
            
            return message;
        } catch (e) {
            // Si no es JSON, devolver la línea completa
            return logLine;
        }
    }

    async readLogs(type = 'all', lines = 100, fromDate = null, toDate = null) {
        const logFiles = this.getLogFiles(type);
        let logContent = [];

        for (const logFile of logFiles) {
            if (fs.existsSync(logFile)) {
                try {
                    const content = fs.readFileSync(logFile, 'utf8');
                    const fileLines = content.split('\n').filter(line => line.trim());
                    
                    const fileName = path.basename(logFile);
                    const parsedLines = fileLines.map(line => {
                        const timestamp = this.extractTimestamp(line);
                        const level = this.extractLogLevel(line);
                        const message = this.extractLogMessage(line);
                        
                        return {
                            file: fileName,
                            content: message,
                            originalLine: line, // Mantener línea original para debugging
                            timestamp: timestamp,
                            level: level,
                            date: new Date(timestamp)
                        };
                    });

                    // Filtrar por rango de fechas si se especifica
                    let filteredLines = parsedLines;
                    if (fromDate || toDate) {
                        filteredLines = parsedLines.filter(log => {
                            const logDate = log.date;
                            if (fromDate && logDate < new Date(fromDate)) return false;
                            if (toDate && logDate > new Date(toDate)) return false;
                            return true;
                        });
                    }

                    logContent.push(...filteredLines);
                } catch (error) {
                    console.error(`Error leyendo archivo de log ${logFile}:`, error);
                    // Agregar log de error para debugging
                    logContent.push({
                        file: path.basename(logFile),
                        content: `Error leyendo archivo: ${error.message}`,
                        timestamp: new Date().toISOString(),
                        level: 'error',
                        date: new Date()
                    });
                }
            } else {
                // Agregar mensaje si el archivo no existe
                logContent.push({
                    file: path.basename(logFile),
                    content: `Archivo de log no encontrado: ${logFile}`,
                    timestamp: new Date().toISOString(),
                    level: 'warn',
                    date: new Date()
                });
            }
        }

        // Ordenar por timestamp descendente y limitar líneas
        logContent.sort((a, b) => b.date - a.date);
        return logContent.slice(0, parseInt(lines));
    }

    getLogFiles(type) {
        const logFiles = [];
        
        if (type === 'all' || type === 'app') {
            logFiles.push(path.join(this.logsDirectory, 'sagesync.log'));
        }
        if (type === 'all' || type === 'error') {
            logFiles.push(path.join(this.logsDirectory, 'error.log'));
        }
        
        return logFiles;
    }

    async getLogsByDate(date, type = 'all') {
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);
        
        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);
        
        const fromDate = startOfDay.toISOString();
        const toDate = endOfDay.toISOString();
        
        return await this.readLogs(type, 1000, fromDate, toDate);
    }

    async getAvailableDates(type = 'all') {
        try {
            const logs = await this.readLogs(type, 10000); // Obtener muchos logs para análisis
            const dates = new Set();
            
            logs.forEach(log => {
                if (log.timestamp) {
                    const date = new Date(log.timestamp);
                    if (!isNaN(date.getTime())) {
                        const dateString = date.toISOString().split('T')[0]; // YYYY-MM-DD
                        dates.add(dateString);
                    }
                }
            });
            
            return Array.from(dates).sort().reverse(); // Más recientes primero
        } catch (error) {
            console.error('Error obteniendo fechas disponibles:', error);
            return [];
        }
    }

    async getLogStats() {
        try {
            const logs = await this.readLogs('all', 1000);
            const stats = {
                total: logs.length,
                errors: logs.filter(log => log.level === 'error').length,
                warnings: logs.filter(log => log.level === 'warn').length,
                info: logs.filter(log => log.level === 'info').length,
                lastUpdate: logs.length > 0 ? logs[0].timestamp : null
            };
            return stats;
        } catch (error) {
            throw new Error(`Error obteniendo estadísticas de logs: ${error.message}`);
        }
    }
}

module.exports = LogParser;
