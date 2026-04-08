const express = require('express');
const systemController = require('../controllers/systemController');
const logsController = require('../controllers/logsController');
const licenseConfig = require('../config/license');
const { getStatus } = require('../services/LicenseValidator');

const router = express.Router();

// STS-01: License status endpoint — always accessible regardless of license state
// Path: /system/license → becomes /api/system/license (routes/index mounts systemRoutes at '/', main.js mounts at /api)
router.get('/system/license', (_req, res) => {
    const status = getStatus();
    res.json({
        ...status,
        hmacConfigured: Boolean(licenseConfig.hmacSecret),
    });
});

// Rutas del sistema
router.get('/status', systemController.getSystemStatus);
router.get('/test/connections', systemController.testConnections);

// Rutas de logs
router.get('/logs', logsController.getLogs);
router.get('/logs/stats', logsController.getLogStats);
router.get('/logs/dates', logsController.getAvailableDates);
router.get('/logs/test', logsController.testLogs);

module.exports = router;
