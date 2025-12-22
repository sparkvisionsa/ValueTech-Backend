const express = require('express');
const router = express.Router();

const authMiddleware = require('../../application/middleware/authMiddleware');
const companesController = require('../controllers/companes.controller');

router.use(authMiddleware);

// Persist fetched Taqeem companies for the logged-in user (phone is read from JWT)
router.post('/sync', companesController.syncCompanies);

// Get saved companies for the logged-in user (optional ?type=real-estate|equipment)
router.get('/me', companesController.listMyCompanies);

module.exports = router;
