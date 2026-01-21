const express = require('express');
const reportRoutes = require('../routes/report.routes');
const packageRoutes = require('../routes/package.routes');
const userRoutes = require('../routes/user.routes');
const systemRoutes = require('../routes/system.routes');
const updateRoutes = require('./update.routes');
const companyRoutes = require('../routes/company.routes');
const companesRoutes = require('../routes/companes.routes');
const uploadRoute = require("../routes/upload.route");
const elrajhiUploadRoute = require("../routes/elrajhiUpload.route");
const duplicateReportRoutes = require("../routes/duplicateReport.routes");
const multiApproachRoutes = require("../routes/multiApproach.route");
const submitReportsQuicklyRoutes = require("../routes/submitReportsQuickly.route");
const ticketRoutes = require("../routes/ticket.routes");
const notificationRoutes = require("../routes/notification.routes");
const filesRoutes = require("../routes/files.routes");

// ✅ NEW
const reportLookupRoutes = require("../routes/reportLookup.route");

const buildVersion = require("../../../build-version.json");

const router = express.Router();

router.use('/report', reportRoutes);
router.use('/packages', packageRoutes);
router.use('/users', userRoutes);
router.use('/system', systemRoutes);
router.use('/updates', updateRoutes);
router.use('/companies', companyRoutes);
router.use('/companes', companesRoutes);

// NOTE: you had this twice; keep one
router.use("/upload", uploadRoute);

router.use("/elrajhi-upload", elrajhiUploadRoute);
router.use("/duplicate-report", duplicateReportRoutes);
router.use("/multi-approach", multiApproachRoutes);
router.use("/submit-reports-quickly", submitReportsQuicklyRoutes);
router.use("/tickets", ticketRoutes);
router.use('/notifications', notificationRoutes);
router.use('/files', filesRoutes);

// ✅ NEW endpoint group
router.use('/report-lookup', reportLookupRoutes);

router.get('/health', (req, res) => res.json({ ok: true, version: buildVersion.build }));

module.exports = router;
