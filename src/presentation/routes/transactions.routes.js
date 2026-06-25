const express = require("express");
const router = express.Router();
const {
  listTransactions,
  getTransaction,
  bulkGetTransactions,
  setReportId,
} = require("../controllers/transactions.controller");

// GET /api/transactions          — paginated list with optional filters
router.get("/", listTransactions);

// POST /api/transactions/bulk    — fetch multiple by ids (must come before /:id)
router.post("/bulk", bulkGetTransactions);

// GET /api/transactions/:id      — single transaction by MongoDB _id
router.get("/:id", getTransaction);

// PATCH /api/transactions/:id/set-report-id — persist Taqeem report_id
router.patch("/:id/set-report-id", setReportId);

module.exports = router;
