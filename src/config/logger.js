const winston = require('winston');
const path = require('path');
require('dotenv').config();

// Crear directorio de logs si no existe
const fs = require('fs');
const logDir = path.dirname(process.env.LOG_FILE || 'logs/sagesync.log');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

// Winston compara el tamaño del archivo contra maxsize, así que necesita bytes:
// con el texto "10m" que trae la documentación, los logs nunca rotaban.
// LOG_MAX_SIZE acepta bytes ("10485760") o sufijo k/m/g ("10m"); si no se
// entiende, se usan 10 MB. Con tailable, el archivo sin número siempre es el
// más reciente: el visor de logs del dashboard solo lee sagesync.log y error.log.
const TAMANO_MAXIMO_DEFAULT = 10 * 1024 * 1024;
function tamanoEnBytes(valor) {
    const match = /^\s*(\d+(?:\.\d+)?)\s*([kmg])?b?\s*$/i.exec(valor || '');
    if (!match) return TAMANO_MAXIMO_DEFAULT;
    const unidades = { k: 1024, m: 1024 ** 2, g: 1024 ** 3 };
    const bytes = Math.round(Number(match[1]) * (unidades[(match[2] || '').toLowerCase()] || 1));
    return bytes > 0 ? bytes : TAMANO_MAXIMO_DEFAULT;
}
const maxsize = tamanoEnBytes(process.env.LOG_MAX_SIZE);
const maxFiles = parseInt(process.env.LOG_MAX_FILES, 10) || 5;

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
            maxsize,
            maxFiles,
            tailable: true
        }),
        // Escribir todos los logs a combined.log
        new winston.transports.File({
            filename: process.env.LOG_FILE || path.join(logDir, 'sagesync.log'),
            maxsize,
            maxFiles,
            tailable: true
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
