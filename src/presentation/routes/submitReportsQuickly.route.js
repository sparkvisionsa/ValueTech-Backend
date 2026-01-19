const express = require("express");
const router = express.Router();

const authMiddleware = require("../../application/middleware/authMiddleware");
const upload = require("../../utils/upload.multer");
const {
  processSubmitReportsQuicklyBatch,
  listSubmitReportsQuickly,
  updateSubmitReportsQuickly,
  getQuickReportsByUserId,
  deleteSubmitReportsQuickly,
  updateSubmitReportsQuicklyAsset,
  deleteSubmitReportsQuicklyAsset,
} = require("../controllers/submitReportsQuickly.controller");

router.get("/", authMiddleware, listSubmitReportsQuickly);
router.get("/user", authMiddleware, getQuickReportsByUserId);
router.patch("/:id", authMiddleware, updateSubmitReportsQuickly);
router.delete("/:id", authMiddleware, deleteSubmitReportsQuickly);
router.patch("/:id/assets/:index", authMiddleware, updateSubmitReportsQuicklyAsset);
router.delete("/:id/assets/:index", authMiddleware, deleteSubmitReportsQuicklyAsset);

// POST /api/submit-reports-quickly
router.post(
  "/",
  // authMiddleware,
  (req, res, next) => {
    console.log("📥 API HIT: POST /api/submit-reports-quickly");
    next();
  },
  authMiddleware,
  upload.fields([
    { name: "excels", maxCount: 50 }, // multiple excel files
    { name: "pdfs", maxCount: 500 },  // multiple pdf files
  ]),
  processSubmitReportsQuicklyBatch
);

module.exports = router;



