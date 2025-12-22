const express = require('express');
const packageController = require('../controllers/package.controller');
const authMiddleware = require('../middleware/auth.middleware'); // Assuming it exists

const router = express.Router();

router.get('/', packageController.getAllPackages);
router.post('/', authMiddleware, packageController.addPackage); // Assuming auth for add
router.put('/:id', authMiddleware, packageController.updatePackage);
router.delete('/:id', authMiddleware, packageController.deletePackage);
router.post('/subscribe', authMiddleware, packageController.subscribeToPackage);
router.get('/subscriptions', authMiddleware, packageController.getUserSubscriptions);

module.exports = router;
