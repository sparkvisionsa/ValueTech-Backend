const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth.middleware");
const {
  validateReport,
  getReportDeletions,
  storeReportDeletion,
  getCheckedReports,
  getValidationResults,
  handleCancelledReport,
} = require("../controllers/deleteReports.controller");

// Validate a report
router.post("/validate/:reportId", authMiddleware, validateReport);

// Get report deletions (with pagination)
router.get("/deletions", authMiddleware, getReportDeletions);

// Store a deletion record
router.post("/deletions", authMiddleware, storeReportDeletion);

// Get checked reports (with pagination)
router.get("/checked", authMiddleware, getCheckedReports);

// Get validation results for multiple reports
router.post("/validation-results", authMiddleware, getValidationResults);

// Handle cancelled report (change status)
router.post("/change-status/:reportId", authMiddleware, handleCancelledReport);

module.exports = router;
