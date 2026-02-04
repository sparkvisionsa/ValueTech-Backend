const express = require("express");
const router = express.Router();

const {
  getReportsByBatchId,
  findReportByReportId,
  findReportById,
  updateMacroSubmitState,
  markAllMacrosComplete,
  updateReportStatus,
  resolveCompanyOfficeId,
  updateReportStatusWithId,
  recomputeReportStatus,
  updateReportWithMacroIds,
  setFlowStartTime,
  setFlowStartTimeWithId,
  setFlowEndTime,
  updateMultipleMacros,
  updateAssetsByIndex,
  setFlowEndTimeWithId,
  getLatestDuplicateReport,
  setReportId,
  getReportsBulk,
  updateElrajhiStatus,
  updateStartTimeByBatchId,
  getReportsBulkByReportId,
  updateReportPgCount,
  updateReportCheckStatus,
  updateReportTimestamp,
} = require("../controllers/newScript.controller");

router.get("/batch/:batch_id", getReportsByBatchId);
router.get("/report-id/:report_id", findReportByReportId);
router.get("/id/:id", findReportById);
router.get("/latest-duplicate", getLatestDuplicateReport);
router.get("/bulk", getReportsBulk);
router.get("/bulk/report_id", getReportsBulkByReportId);
router.get("/resolve-company-office-id/:report_id", resolveCompanyOfficeId);

router.patch(
  "/:report_id/macro/:macro_id/submit-state",
  updateMacroSubmitState,
);
router.patch("/:report_id/update-multiple-macros", updateMultipleMacros);
router.patch("/:record_id/update-assets-by-index", updateAssetsByIndex);
router.patch("/:report_id/mark-all-complete", markAllMacrosComplete);
router.patch("/:report_id/status", updateReportStatus);
router.patch("/id/:id/status", updateReportStatusWithId);
router.patch("/:report_id/recompute-status", recomputeReportStatus);
router.patch("/:report_id/update-macros", updateReportWithMacroIds);
router.patch("/update-check-status", updateReportCheckStatus);
router.patch("/update-elrajhi-status/:record_id", updateElrajhiStatus);
router.patch("/update-report-timestamp/:record_id", updateReportTimestamp);
router.patch("/:report_id/pg-count", updateReportPgCount);

router.patch("/:record_id/set-report-id", setReportId);

router.patch("/set-flow-start-time/:report_id", setFlowStartTime);
router.patch("/set-flow-end-time/:report_id", setFlowEndTime);
router.patch("/set-start-time-by-batch-id/:batch_id", updateStartTimeByBatchId);

router.patch("/set-start-time-with-id/:record_id", setFlowStartTimeWithId);
router.patch("/set-end-time-with-id/:record_id", setFlowEndTimeWithId);

module.exports = router;
