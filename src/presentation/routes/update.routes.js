const express = require('express');
const updateController = require('../controllers/update.controller');
const authMiddleware = require('../middleware/auth.middleware');
const adminOnly = require('../middleware/adminOnly.middleware');

const router = express.Router();

router.get('/notifications/latest', updateController.latestUpdateNotice);
router.get('/', authMiddleware, adminOnly, updateController.listUpdates);
router.post('/', authMiddleware, adminOnly, updateController.createUpdate);
router.patch('/:id/status', authMiddleware, adminOnly, updateController.updateStatus);

router.get('/my', authMiddleware, updateController.getUserUpdates);
router.post('/:id/download', authMiddleware, updateController.markDownloaded);
router.post('/:id/apply', authMiddleware, updateController.markApplied);

module.exports = router;
