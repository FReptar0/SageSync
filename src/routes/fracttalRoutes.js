const express = require('express');
const fracttalController = require('../controllers/fracttalController');

const router = express.Router();

// Rutas de Fracttal
router.get('/fracttal/warehouses', fracttalController.getFracttalWarehouses);

module.exports = router;
