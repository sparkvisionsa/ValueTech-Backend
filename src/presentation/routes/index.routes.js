const express = require('express');
const reportRoutes = require('../routes/report.routes');
const packageRoutes = require('../routes/package.routes');
const userRoutes = require('../routes/user.routes');
const systemRoutes = require('../routes/system.routes');
const updateRoutes = require('./update.routes');
const companyRoutes = require('../routes/company.routes');
const uploadRoute = require("../routes/upload.route");
const elrajhiUploadRoute = require("../routes/elrajhiUpload.route");
const duplicateReportRoutes = require("../routes/duplicateReport.routes");
const multiApproachRoutes = require("../routes/multiApproach.route");



const router = express.Router();

router.use('/report', reportRoutes);
router.use('/packages', packageRoutes);
router.use('/users', userRoutes);
router.use('/system', systemRoutes);
router.use('/updates', updateRoutes);
router.use('/companies', companyRoutes);
router.use("/upload", uploadRoute);
router.use("/upload", uploadRoute);
router.use("/elrajhi-upload", elrajhiUploadRoute);
router.use("/duplicate-report", duplicateReportRoutes);
router.use("/multi-approach", multiApproachRoutes);

router.get('/health', (req, res) => res.json({ ok: true }));

module.exports = router;
