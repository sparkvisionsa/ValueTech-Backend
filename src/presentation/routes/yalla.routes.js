// src/routes/yalla.routes.js
const router = require("express").Router();
const ctrl = require("../controllers/yalla.controller");

// main listing + search + filters
router.get("/", ctrl.listCars);

// single car
router.get("/cars/one", ctrl.getOne);

// facets (brand/model/year counts)
router.get("/cars/facets", ctrl.getFacets);

// dropdown helpers
router.get("/cars/brands", ctrl.getBrands);
router.get("/cars/models", ctrl.getModelsByBrand);
router.get("/cars/years", ctrl.getYears);
router.get("/cars/cities", ctrl.getCities);

module.exports = router;


// GET http://localhost:3000/api/yalla?page=1&limit=20
// GET http://localhost:3000/api/yalla?q=Avantgarde
// GET http://localhost:3000/api/yalla?brand=مرسيدس%20بنز
//GET http://localhost:3000/api/yalla?brand=مرسيدس%20بنز&model=الفئة%20في
// GET http://localhost:3000/api/yalla?year=2026
//GET http://localhost:3000/api/yalla?minPrice=800000&maxPrice=900000
// GET http://localhost:3000/api/yalla/cars/brands
//GET http://localhost:3000/api/yalla/cars/models?brand=مرسيدس%20بنز
// GET http://localhost:3000/api/yalla/cars/years
// GET http://localhost:3000/api/yalla/cars/cities
//GET http://localhost:3000/api/yalla/cars/facets?brand=مرسيدس%20بنز


