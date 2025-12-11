// src/presentation/routes/elrajhiUpload.route.js
const express = require("express");
const router = express.Router();

const upload = require("../../utils/upload.multer");
const {
  processElrajhiExcel,
} = require("../controllers/elrajhiUpload.controller");
const authMiddleware = require("../../application/middleware/authMiddleware");

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

module.exports = router;
