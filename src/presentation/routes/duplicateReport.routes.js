const express = require("express");
const router = express.Router();
const upload = require("../../utils/upload.multer");
const authMiddleware = require("../../application/middleware/authMiddleware");
const duplicateReportController = require("../controllers/duplicateReport.controller");

router.use(authMiddleware);

router.get("/latest", duplicateReportController.getLatestForUser);
router.get("/", duplicateReportController.listReportsForUser);
router.patch("/:id", duplicateReportController.updateDuplicateReport);
router.delete("/:id", duplicateReportController.deleteDuplicateReport);
router.patch("/:id/assets/:index", duplicateReportController.updateDuplicateReportAsset);
router.delete("/:id/assets/:index", duplicateReportController.deleteDuplicateReportAsset);
router.post(
  "/",
  (req, res, next) => {
    console.log("📥 API HIT:Duplicate Reports");
    next();
  },
  authMiddleware,
  upload.fields([
    { name: "excel", maxCount: 1 },
    { name: "pdf", maxCount: 1 },
  ]),
  duplicateReportController.createDuplicateReport
);

module.exports = router;
