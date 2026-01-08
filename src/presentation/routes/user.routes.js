const express = require('express');

const userController = require('../controllers/user.controller');
const authMiddleware = require('../middleware/auth.middleware');
const optionalAuth = require('../middleware/optionalAuth.middleware');

const router = express.Router();

router.post('/register', userController.register);
router.post('/login', userController.login);

router.post('/bootstrap', optionalAuth, userController.taqeemBootstrap);
router.post('/new-bootstrap', userController.newTaqeemBootstrap);

router.post('/authorize', authMiddleware, userController.authorizeTaqeem);

module.exports = router;
