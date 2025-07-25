const fs = require('fs');
const path = require('path');

class LogParser {
    constructor(logsDirectory) {
        this.logsDirectory = logsDirectory;
    }

    extractTimestamp(logLine) {
        const timestampRegex = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/;
        const match = logLine.match(timestampRegex);
        return match ? match[0] : new Date().toISOString();
    }

    async readLogs(type = 'all', lines = 100) {
        const logFiles = this.getLogFiles(type);
        let logContent = [];

        for (const logFile of logFiles) {
            if (fs.existsSync(logFile)) {
                const content = fs.readFileSync(logFile, 'utf8');
                const fileLines = content.split('\n').filter(line => line.trim());
                
                const fileName = path.basename(logFile);
                logContent.push(...fileLines.map(line => ({
                    file: fileName,
                    content: line,
                    timestamp: this.extractTimestamp(line),
                    level: this.extractLogLevel(line)
                })));
            }
        }

        // Ordenar por timestamp descendente y limitar líneas
        logContent.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
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
        if (lowerContent.includes('error') || lowerContent.includes('❌')) {
            return 'error';
        } else if (lowerContent.includes('warn') || lowerContent.includes('⚠️')) {
            return 'warn';
        } else if (lowerContent.includes('info') || lowerContent.includes('✅')) {
            return 'info';
        }
        return 'default';
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
