const express = require('express');
const systemController = require('../controllers/systemController');
const logsController = require('../controllers/logsController');

const router = express.Router();

// Rutas del sistema
router.get('/status', systemController.getSystemStatus);
router.get('/test/connections', systemController.testConnections);

// Rutas de logs
router.get('/logs', logsController.getLogs);
router.get('/logs/stats', logsController.getLogStats);

module.exports = router;
