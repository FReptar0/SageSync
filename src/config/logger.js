const winston = require('winston');
const path = require('path');
require('dotenv').config();

// Crear directorio de logs si no existe
const fs = require('fs');
const logDir = path.dirname(process.env.LOG_FILE || 'logs/sagesync.log');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss'
        }),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    defaultMeta: { service: 'sagesync' },
    transports: [
        // Escribir todos los logs con nivel 'error' y menor a error.log
        new winston.transports.File({
            filename: path.join(logDir, 'error.log'),
            level: 'error',
            maxsize: process.env.LOG_MAX_SIZE || '10m',
            maxFiles: process.env.LOG_MAX_FILES || 5
        }),
        // Escribir todos los logs a combined.log
        new winston.transports.File({
            filename: process.env.LOG_FILE || path.join(logDir, 'sagesync.log'),
            maxsize: process.env.LOG_MAX_SIZE || '10m',
            maxFiles: process.env.LOG_MAX_FILES || 5
        })
    ]
});

// Si no estamos en producción, también log a la consola
if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
        )
    }));
}

module.exports = logger;
