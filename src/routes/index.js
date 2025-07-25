const express = require('express');
const systemRoutes = require('./systemRoutes');
const syncRoutes = require('./syncRoutes');
const sageRoutes = require('./sageRoutes');
const fracttalRoutes = require('./fracttalRoutes');
const logsRoutes = require('./logsRoutes');

const router = express.Router();

// Montar todas las rutas de la API
router.use('/', systemRoutes);
router.use('/', syncRoutes);
router.use('/', sageRoutes);
router.use('/', fracttalRoutes);
router.use('/', logsRoutes);

module.exports = router;
