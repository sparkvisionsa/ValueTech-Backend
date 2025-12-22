const express = require('express');
const systemController = require('../controllers/system.controller');
const authMiddleware = require('../middleware/auth.middleware');
const adminOnly = require('../middleware/adminOnly.middleware');

const router = express.Router();

router.get('/state', systemController.getSystemState);
router.put('/state', authMiddleware, adminOnly, systemController.updateSystemState);

module.exports = router;
