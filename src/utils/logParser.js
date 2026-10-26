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
                            originalLine: line,
                            timestamp: timestamp,
                            level: level,
                            date: this.parseTimestamp(timestamp)
                        };
                    });

                    // Filtrar por rango de fechas si se especifica
                    let filteredLines = parsedLines;
                    if (fromDate || toDate) {
                        filteredLines = parsedLines.filter(log => {
                            if (!log.date || isNaN(log.date.getTime())) return false;
                            
                            if (fromDate) {
                                const fromDateTime = new Date(fromDate + 'T00:00:00.000Z');
                                if (log.date < fromDateTime) return false;
                            }
                            
                            if (toDate) {
                                const toDateTime = new Date(toDate + 'T23:59:59.999Z');
                                if (log.date > toDateTime) return false;
                            }
                            
                            return true;
                        });
                    }

                    // Sin spread: push(...lineas) con decenas de miles de líneas revienta
                    // la pila ("Maximum call stack size exceeded") después de una carga grande.
                    for (const line of filteredLines) {
                        logContent.push(line);
                    }
                } catch (error) {
                    console.error(`Error leyendo archivo de log ${logFile}:`, error);
                    logContent.push({
                        file: path.basename(logFile),
                        content: `Error leyendo archivo: ${error.message}`,
                        timestamp: new Date().toISOString(),
                        level: 'error',
                        date: new Date()
                    });
                }
            } else {
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

    parseTimestamp(timestamp) {
        if (!timestamp) return new Date();
        
        try {
            // Intentar parsear directamente
            const date = new Date(timestamp);
            if (!isNaN(date.getTime())) {
                return date;
            }
            
            // Si es formato "YYYY-MM-DD HH:mm:ss", agregar T y Z
            if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(timestamp)) {
                return new Date(timestamp.replace(' ', 'T') + 'Z');
            }
            
            return new Date();
        } catch (e) {
            return new Date();
        }
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
        try {
            // Validar formato de fecha
            if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
                throw new Error(`Formato de fecha inválido: ${date}. Esperado: YYYY-MM-DD`);
            }
            
            const startOfDay = new Date(date + 'T00:00:00.000Z');
            const endOfDay = new Date(date + 'T23:59:59.999Z');
            
            if (isNaN(startOfDay.getTime()) || isNaN(endOfDay.getTime())) {
                throw new Error(`Fecha inválida: ${date}`);
            }
            
            const fromDate = date; // YYYY-MM-DD format
            const toDate = date;   // YYYY-MM-DD format
            
            return await this.readLogs(type, 1000, fromDate, toDate);
        } catch (error) {
            console.error('Error en getLogsByDate:', error);
            throw error;
        }
    }

    async getAvailableDates(type = 'all') {
        try {
            const logs = await this.readLogs(type, 10000);
            const dates = new Set();
            
            logs.forEach(log => {
                if (log.timestamp && log.date && !isNaN(log.date.getTime())) {
                    const dateString = log.date.toISOString().split('T')[0]; // YYYY-MM-DD
                    dates.add(dateString);
                }
            });
            
            const sortedDates = Array.from(dates).sort().reverse(); // Más recientes primero
            console.log(`DEBUG: Fechas disponibles encontradas: ${sortedDates.length}`, sortedDates);
            
            return sortedDates;
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
