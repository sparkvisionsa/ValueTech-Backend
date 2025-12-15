// src/presentation/routes/elrajhiUpload.route.js
const express = require("express");
const router = express.Router();
const authMiddleware = require("../../application/middleware/authMiddleware");

const upload = require("../../utils/upload.multer");
const {
  processElrajhiExcel,
  exportElrajhiBatch,
  listElrajhiBatches,
  getElrajhiBatchReports,
} = require("../controllers/elrajhiUpload.controller");

// Require authentication so processElrajhiExcel receives req.user (phone, id, etc.)
router.post(
  "/",
  authMiddleware,
  (req, res, next) => {
    console.log("📥 API HIT: POST /api/elrajhi-upload");
    next();
  },
  upload.fields([
    { name: "excel", maxCount: 1 },
    { name: "pdfs", maxCount: 5000 },
  ]),
  processElrajhiExcel
);

router.get(
  "/export/:batchId",
  exportElrajhiBatch
);

router.get(
  "/batches",
  listElrajhiBatches
);

router.get(
  "/batches/:batchId/reports",
  getElrajhiBatchReports
);

module.exports = router;
