const express = require("express");
const router = express.Router();

const upload = require("../../utils/upload.multer");
const {
  processMultiApproachBatch,
} = require("../controllers/multiApproach.controller");

// POST /api/reports/multi-approach/batch
router.post(
  "/",
  (req, res, next) => {
    console.log("📥 API HIT: POST /api/upload-multi-approach");
    next();
  },
  upload.fields([
    { name: "excels", maxCount: 50 }, // multiple excel files
    { name: "pdfs", maxCount: 500 },  // multiple pdf files
  ]),
  processMultiApproachBatch
);

module.exports = router;