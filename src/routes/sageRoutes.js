const express = require('express');
const sageController = require('../controllers/sageController');

const router = express.Router();

// Rutas de Sage300
router.get('/sage/stats', sageController.getSageStats);
router.get('/sage/inventory/:location?', sageController.getSageInventory);

module.exports = router;
