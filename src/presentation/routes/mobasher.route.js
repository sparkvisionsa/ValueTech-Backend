const router = require("express").Router();
const ctrl = require("../controllers/mobasher.controller");

// order matters
router.get("/search", ctrl.search);
router.get("/stats", ctrl.stats);

router.get("/", ctrl.getAllAds);
router.get("/:adId", ctrl.getByAdId);

module.exports = router;
// http://localhost:3000/api/mobasher/search?query=مرسيدس
// http://localhost:3000/api/mobasher?brand=مرسيدس&year=2025
// http://localhost:3000/api/mobasher