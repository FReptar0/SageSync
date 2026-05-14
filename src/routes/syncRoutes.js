const express = require('express');
const syncController = require('../controllers/syncController');

const router = express.Router();

// Rutas de sincronización
router.post('/sync', syncController.manualSync);
router.post('/sync/preview', syncController.previewSync);
router.get('/sync/status', syncController.getSyncStatus);
router.get('/sync/history', syncController.getSyncHistory);

module.exports = router;
