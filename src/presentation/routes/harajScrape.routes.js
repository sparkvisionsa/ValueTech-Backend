const express = require("express");
const {
  getHarajScrapeList,
  getHarajScrapeById,
  getHarajScrapeTags,
} = require("../controllers/harajScrape.controller.js");

const router = express.Router();

// GET /api/harajScrape
router.get("/", getHarajScrapeList);

// GET /api/harajScrape/tags
router.get("/tags", getHarajScrapeTags);

// GET /api/harajScrape/:id
router.get("/:id", getHarajScrapeById);

module.exports = router;
