const express = require('express');
const { getLogs, getLogStats, getAvailableDates, testLogs } = require('../controllers/logsController');

const router = express.Router();

// Rutas para logs
router.get('/api/logs', getLogs);
router.get('/api/logs/dates', getAvailableDates);
router.get('/api/logs/stats', getLogStats);
router.get('/api/logs/test', testLogs);

module.exports = router;
