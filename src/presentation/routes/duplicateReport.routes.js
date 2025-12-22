const express = require("express");
const router = express.Router();
const upload = require("../../utils/upload.multer");
const authMiddleware = require("../../application/middleware/authMiddleware");
const duplicateReportController = require("../controllers/duplicateReport.controller");

router.use(authMiddleware);

router.get("/latest", duplicateReportController.getLatestForUser);
router.post(
  "/",
  upload.fields([
    { name: "excel", maxCount: 1 },
    { name: "pdf", maxCount: 1 },
  ]),
  duplicateReportController.createDuplicateReport
);

module.exports = router;
