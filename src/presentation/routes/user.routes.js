const express = require('express');

const userController = require('../controllers/user.controller');
const authMiddleware = require('../middleware/auth.middleware');
const optionalAuth = require('../middleware/optionalAuth.middleware');
const profileUpload = require('../../utils/profileUpload.multer');

const router = express.Router();

router.post('/register', optionalAuth, userController.register);
router.post('/login', userController.login);

router.post('/guest', optionalAuth, userController.guestBootstrap);
router.post('/bootstrap', optionalAuth, userController.taqeemBootstrap);
router.post('/new-bootstrap', userController.newTaqeemBootstrap);

router.post('/authorize', authMiddleware, userController.authorizeTaqeem);
router.post('/profile-image', authMiddleware, profileUpload.single('profileImage'), userController.uploadProfileImage);

module.exports = router;
