const express = require('express');
const filesController = require('../controllers/files.controller');

const router = express.Router();

router.get('/:id', filesController.getFile);

module.exports = router;
