const fs = require('fs');
const path = require('path');

class LogParser {
    constructor(logsDirectory) {
        this.logsDirectory = logsDirectory;
    }

    extractTimestamp(logLine) {
        // Múltiples formatos de timestamp
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
                        return {
                            file: fileName,
                            content: line,
                            timestamp: timestamp,
                            level: this.extractLogLevel(line),
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
                }
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

    extractLogLevel(logLine) {
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

    async getLogsByDate(date, type = 'all') {
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);
        
        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);
        
        return await this.readLogs(type, 1000, startOfDay, endOfDay);
    }

    async getAvailableDates(type = 'all') {
        const logs = await this.readLogs(type, 10000); // Obtener muchos logs para análisis
        const dates = new Set();
        
        logs.forEach(log => {
            const date = new Date(log.timestamp);
            const dateString = date.toISOString().split('T')[0]; // YYYY-MM-DD
            dates.add(dateString);
        });
        
        return Array.from(dates).sort().reverse(); // Más recientes primero
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
