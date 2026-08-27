// companes.routes.js
const express = require('express');
const router = express.Router();
const companesController = require('../controllers/companes.controller');

router.post('/sync', companesController.syncCompanies);
router.get('/me', companesController.listMyCompanies);

module.exports = router;
