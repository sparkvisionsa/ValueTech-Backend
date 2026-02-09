const express = require("express");
const router = express.Router();

const authMiddleware = require("../../application/middleware/authMiddleware");
const optionalAuth = require("../middleware/optionalAuth.middleware");
const upload = require("../../utils/upload.multer");
const {
  processMultiApproachBatch,
  createManualMultiApproachReport,
  listMultiApproachReports,
  getMultiApproachReportsByUserId,
  updateMultiApproachReport,
  deleteMultiApproachReport,
  updateMultiApproachAsset,
  deleteMultiApproachAsset,
} = require("../controllers/multiApproach.controller");

router.get("/", authMiddleware, listMultiApproachReports);
router.get("/user", authMiddleware, getMultiApproachReportsByUserId);
router.patch("/:id", authMiddleware, upload.single("pdf"), updateMultiApproachReport);
router.delete("/:id", authMiddleware, deleteMultiApproachReport);
router.patch("/:id/assets/:index", authMiddleware, updateMultiApproachAsset);
router.delete("/:id/assets/:index", authMiddleware, deleteMultiApproachAsset);

// POST /api/reports/multi-approach/batch
router.post(
  "/",
  (req, res, next) => {
    console.log("📥 API HIT: POST /api/upload-multi-approach");
    next();
  },
  authMiddleware,
  upload.fields([
    { name: "excels", maxCount: 50 }, // multiple excel files
    { name: "pdfs", maxCount: 500 },  // multiple pdf files
  ]),
  processMultiApproachBatch
);

// Manual entry flow
router.post("/manual", optionalAuth, createManualMultiApproachReport);

module.exports = router;
