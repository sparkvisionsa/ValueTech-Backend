const express = require('express');
const companyController = require('../controllers/company.controller');
const authMiddleware = require('../../application/middleware/authMiddleware');

const router = express.Router();

router.use(authMiddleware);
router.get('/members', companyController.listMembers);
router.post('/members', companyController.createMember);
router.put('/members/:id', companyController.updateMember);
router.delete('/members/:id', companyController.deleteMember);

module.exports = router;
