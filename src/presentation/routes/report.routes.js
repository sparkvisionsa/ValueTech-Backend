const express = require('express');
const reportController = require('../controllers/report.controller');
const authMiddleware = require('../middleware/auth.middleware');

const router = express.Router();


router.get('/reportExistenceCheck/:reportId', reportController.reportExistenceCheck);
router.get('/checkMissingPages/:reportId', reportController.checkMissingPages);
router.get('/getAllReports', reportController.getAllReports);
router.get('/getReportsByUserId', authMiddleware, reportController.getReportsByUserId);

router.post('/createReport', reportController.createReport);
router.post('/createReportWithCommonFields', authMiddleware, reportController.createReportWithCommonFields);
router.put('/addCommonFields', reportController.addCommonFields);
router.patch(
    "/:reportId/assets/:assetUid",
    reportController.updateAsset
);
router.patch("/:id/company-office", authMiddleware, reportController.updateCompanyOfficeId);


module.exports = router;
