const express = require("express");
const router = express.Router();
const upload = require("../../utils/upload.multer");
const { processUpload } = require("../controllers/upload.controller");

router.post(
  "/",
  (req, res, next) => {
    console.log("📥 API HIT: POST /api/upload");
    next();
  },
  upload.fields([
    { name: "excel", maxCount: 1 },
    { name: "pdfs", maxCount: 5000 }
  ]),
  processUpload
);

module.exports = router;
