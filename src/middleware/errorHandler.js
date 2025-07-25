const logger = require('../config/logger');

const errorHandler = (error, req, res, next) => {
    // Log del error con contexto
    logger.error(`Error en ${req.method} ${req.path}:`, {
        error: error.message,
        stack: error.stack,
        body: req.body,
        query: req.query,
        params: req.params,
        ip: req.ip,
        userAgent: req.get('User-Agent')
    });

    // Errores operacionales conocidos
    if (error.isOperational) {
        return res.status(error.statusCode || 500).json({
            error: error.message,
            code: error.code || 'OPERATIONAL_ERROR'
        });
    }

    // Errores de validación
    if (error.name === 'ValidationError') {
        return res.status(400).json({
            error: 'Datos de entrada inválidos',
            details: error.details
        });
    }

    // Errores de base de datos
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
        return res.status(503).json({
            error: 'Servicio temporalmente no disponible',
            code: 'SERVICE_UNAVAILABLE'
        });
    }

    // Error genérico del servidor
    res.status(500).json({
        error: 'Error interno del servidor',
        code: 'INTERNAL_SERVER_ERROR'
    });
};

const asyncHandler = (fn) => {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
};

module.exports = {
    errorHandler,
    asyncHandler
};
