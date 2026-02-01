// routes/report.routes.js
const express = require("express");
const router = express.Router();

const authMiddleware = require("../../application/middleware/authMiddleware");
const {
  getReportsByBatchId,
  findReportByReportId,
  findReportById,
  updateMacroSubmitState,
  markAllMacrosComplete,
  updateReportStatus,
  recomputeReportStatus,
  updateReportWithMacroIds,
} = require("../controllers/newScript.controller");

router.get("/batch/:batch_id", getReportsByBatchId);
router.get("/report-id/:report_id", findReportByReportId);
router.get("/:id", findReportById);

router.patch(
  "/:report_id/macro/:macro_id/submit-state",
  updateMacroSubmitState,
);
router.patch("/:report_id/mark-all-complete", markAllMacrosComplete);
router.patch("/:report_id/status", authMiddleware, updateReportStatus);
router.patch("/:report_id/recompute-status", recomputeReportStatus);
router.patch("/:report_id/update-macros", updateReportWithMacroIds);

module.exports = router;
