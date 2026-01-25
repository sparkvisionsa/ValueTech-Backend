const router = require("express").Router();
const ctrl = require("../controllers/harajAds.controller");

router.get("/", ctrl.list);
router.get("/:adId", ctrl.getOne);
router.get("/:adId/comments", ctrl.getComments);

module.exports = router;
