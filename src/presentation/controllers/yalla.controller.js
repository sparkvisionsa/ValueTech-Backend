// src/controllers/yalla.controller.js
const YallaModel = require("../../infrastructure/models/yalla.model");

// ---------- helpers ----------
function escapeRegex(s = "") {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Breadcrumb indexes: [0]=country, [1]=used-cars, [2]=city, [3]=brand, [4]=model, [5]=year, [6]=title
function getBrandExpr() {
  return { $arrayElemAt: ["$detail.breadcrumb", 3] };
}
function getModelExpr() {
  return { $arrayElemAt: ["$detail.breadcrumb", 4] };
}
function getYearExpr() {
  return {
    $ifNull: [
      { $arrayElemAt: ["$detail.breadcrumb", 5] },
      "$detail.importantSpecs.سنة الصنع",
    ],
  };
}
function getCityExpr() {
  return {
    $ifNull: [
      { $arrayElemAt: ["$detail.breadcrumb", 2] },
      "$detail.importantSpecs.الموقع",
    ],
  };
}

/**
 * Build digits-only string from any input (handles: "857,000 ريال", "ريال857,000", "9,000 KM", "9000كم", "-")
 * Then convert safely to int (or null).
 */
function digitsOnlyExpr(inputExpr) {
  return {
    $let: {
      vars: { s: { $toString: { $ifNull: [inputExpr, ""] } } },
      in: {
        $reduce: {
          input: { $range: [0, { $strLenCP: "$$s" }] },
          initialValue: "",
          in: {
            $let: {
              vars: { ch: { $substrCP: ["$$s", "$$this", 1] } },
              in: {
                $cond: [
                  { $regexMatch: { input: "$$ch", regex: /^[0-9]$/ } },
                  { $concat: ["$$value", "$$ch"] },
                  "$$value",
                ],
              },
            },
          },
        },
      },
    },
  };
}

function toIntSafeExpr(inputExpr) {
  return {
    $let: {
      vars: { d: digitsOnlyExpr(inputExpr) },
      in: {
        $convert: {
          input: "$$d",
          to: "int",
          onError: null,
          onNull: null,
        },
      },
    },
  };
}

// build aggregation pipeline for listing + filters
function buildListPipeline(query) {
  const {
    q,
    brand,
    model,
    year,
    city,
    minPrice,
    maxPrice,
    minMileage,
    maxMileage,
    hasImages,
    sort = "newest",
    page = "1",
    limit = "20",
  } = query;

  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.min(100, Math.max(1, Number(limit) || 20));
  const skip = (pageNum - 1) * limitNum;

  const match = {
    detail: { $exists: true, $ne: null },
  };

  // TEXT SEARCH (cardTitle + description + overview)
  if (q && String(q).trim()) {
    const re = new RegExp(escapeRegex(String(q).trim()), "i");
    match.$or = [
      { cardTitle: re },
      { "detail.description": re },
      { "detail.overview.h1": re },
      { "detail.overview.h4": re },
    ];
  }

  const addFields = {
    brandX: getBrandExpr(),
    modelX: getModelExpr(),
    yearX: getYearExpr(),
    cityX: getCityExpr(),

    // ✅ SAFE numeric parsing
    priceNum: toIntSafeExpr({
      $ifNull: ["$detail.priceBox.priceText", "$cardPriceText"],
    }),
    mileageNum: toIntSafeExpr("$detail.importantSpecs.عدد الكيلومترات"),

    imagesCount: { $size: { $ifNull: ["$detail.images", []] } },
  };

  const postMatch = {};

  if (brand) postMatch.brandX = String(brand);
  if (model) postMatch.modelX = String(model);
  if (year) postMatch.yearX = String(year);
  if (city) postMatch.cityX = String(city);

  const minP = Number(minPrice);
  const maxP = Number(maxPrice);
  if (Number.isFinite(minP))
    postMatch.priceNum = { ...(postMatch.priceNum || {}), $gte: minP };
  if (Number.isFinite(maxP))
    postMatch.priceNum = { ...(postMatch.priceNum || {}), $lte: maxP };

  const minM = Number(minMileage);
  const maxM = Number(maxMileage);
  if (Number.isFinite(minM))
    postMatch.mileageNum = { ...(postMatch.mileageNum || {}), $gte: minM };
  if (Number.isFinite(maxM))
    postMatch.mileageNum = { ...(postMatch.mileageNum || {}), $lte: maxM };

  if (hasImages === "1" || hasImages === "true") {
    postMatch.imagesCount = { $gte: 1 };
  }

  // sorting
  let sortStage = { detailScrapedAt: -1 };
  if (sort === "price_asc") sortStage = { priceNum: 1, detailScrapedAt: -1 };
  if (sort === "price_desc") sortStage = { priceNum: -1, detailScrapedAt: -1 };
  if (sort === "mileage_asc")
    sortStage = { mileageNum: 1, detailScrapedAt: -1 };
  if (sort === "mileage_desc")
    sortStage = { mileageNum: -1, detailScrapedAt: -1 };
  if (sort === "oldest") sortStage = { detailScrapedAt: 1 };

  const pipeline = [
    { $match: match },
    { $addFields: addFields },
    Object.keys(postMatch).length ? { $match: postMatch } : null,
    { $sort: sortStage },
    {
      $facet: {
        items: [
          { $skip: skip },
          { $limit: limitNum },
          {
            $project: {
              _id: 1,
              url: 1,
              cardTitle: 1,
              cardPriceText: 1,
              detailScrapedAt: 1,
              lastSeenAt: 1,
              sectionLabel: 1,
              listPageUrl: 1,
              pageNo: 1,

              brand: "$brandX",
              model: "$modelX",
              year: "$yearX",
              city: "$cityX",
              priceNum: 1,
              mileageNum: 1,

              imagesCount: 1,
              coverImage: { $arrayElemAt: ["$detail.images", 0] },
            },
          },
        ],
        meta: [{ $count: "total" }],
      },
    },
    {
      $addFields: {
        total: { $ifNull: [{ $arrayElemAt: ["$meta.total", 0] }, 0] },
        page: pageNum,
        limit: limitNum,
        pages: {
          $ceil: {
            $divide: [
              { $ifNull: [{ $arrayElemAt: ["$meta.total", 0] }, 0] },
              limitNum,
            ],
          },
        },
      },
    },
    { $project: { meta: 0 } },
  ].filter(Boolean);

  return pipeline;
}

// ---------- controllers ----------
exports.listCars = async (req, res) => {
  try {
    const pipeline = buildListPipeline(req.query);
    const [out] = await YallaModel.aggregate(pipeline).allowDiskUse(true);
    return res.json({ success: true, ...(out || { items: [], total: 0, page: 1, limit: 20, pages: 0 }) });
  } catch (e) {
    return res
      .status(500)
      .json({ success: false, message: e.message || String(e) });
  }
};

exports.getOne = async (req, res) => {
  try {
    const url = String(req.query.url || "").trim();
    if (!url)
      return res.status(400).json({ success: false, message: "url is required" });

    // Your docs use _id = url
    const doc = await YallaModel.findOne({ _id: url }).lean();
    if (!doc)
      return res.status(404).json({ success: false, message: "Not found" });

    return res.json({ success: true, item: doc });
  } catch (e) {
    return res
      .status(500)
      .json({ success: false, message: e.message || String(e) });
  }
};

exports.getBrands = async (req, res) => {
  try {
    const rows = await YallaModel.aggregate([
      { $match: { detail: { $exists: true, $ne: null } } },
      { $addFields: { brandX: getBrandExpr() } },
      { $match: { brandX: { $type: "string", $ne: "" } } },
      { $group: { _id: "$brandX", count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
      { $project: { _id: 0, brand: "$_id", count: 1 } },
    ]).allowDiskUse(true);

    res.json({ success: true, items: rows });
  } catch (e) {
    res
      .status(500)
      .json({ success: false, message: e.message || String(e) });
  }
};

exports.getModelsByBrand = async (req, res) => {
  try {
    const brand = String(req.query.brand || "").trim();
    if (!brand)
      return res.status(400).json({ success: false, message: "brand is required" });

    const rows = await YallaModel.aggregate([
      { $match: { detail: { $exists: true, $ne: null } } },
      { $addFields: { brandX: getBrandExpr(), modelX: getModelExpr() } },
      { $match: { brandX: brand, modelX: { $type: "string", $ne: "" } } },
      { $group: { _id: "$modelX", count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
      { $project: { _id: 0, model: "$_id", count: 1 } },
    ]).allowDiskUse(true);

    res.json({ success: true, brand, items: rows });
  } catch (e) {
    res
      .status(500)
      .json({ success: false, message: e.message || String(e) });
  }
};

exports.getYears = async (req, res) => {
  try {
    const rows = await YallaModel.aggregate([
      { $match: { detail: { $exists: true, $ne: null } } },
      { $addFields: { yearX: getYearExpr() } },
      { $match: { yearX: { $type: "string", $ne: "" } } },
      { $group: { _id: "$yearX", count: { $sum: 1 } } },
      { $sort: { _id: -1 } },
      { $project: { _id: 0, year: "$_id", count: 1 } },
    ]).allowDiskUse(true);

    res.json({ success: true, items: rows });
  } catch (e) {
    res
      .status(500)
      .json({ success: false, message: e.message || String(e) });
  }
};

exports.getCities = async (req, res) => {
  try {
    const rows = await YallaModel.aggregate([
      { $match: { detail: { $exists: true, $ne: null } } },
      { $addFields: { cityX: getCityExpr() } },
      { $match: { cityX: { $type: "string", $ne: "" } } },
      { $group: { _id: "$cityX", count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
      { $project: { _id: 0, city: "$_id", count: 1 } },
    ]).allowDiskUse(true);

    res.json({ success: true, items: rows });
  } catch (e) {
    res
      .status(500)
      .json({ success: false, message: e.message || String(e) });
  }
};

exports.getFacets = async (req, res) => {
  try {
    const { q, brand, model, year, city, minPrice, maxPrice, minMileage, maxMileage, hasImages } = req.query;

    const match = { detail: { $exists: true, $ne: null } };

    if (q && String(q).trim()) {
      const re = new RegExp(escapeRegex(String(q).trim()), "i");
      match.$or = [
        { cardTitle: re },
        { "detail.description": re },
        { "detail.overview.h1": re },
        { "detail.overview.h4": re },
      ];
    }

    const postMatch = {};
    if (brand) postMatch.brandX = String(brand);
    if (model) postMatch.modelX = String(model);
    if (year) postMatch.yearX = String(year);
    if (city) postMatch.cityX = String(city);

    const minP = Number(minPrice);
    const maxP = Number(maxPrice);
    if (Number.isFinite(minP))
      postMatch.priceNum = { ...(postMatch.priceNum || {}), $gte: minP };
    if (Number.isFinite(maxP))
      postMatch.priceNum = { ...(postMatch.priceNum || {}), $lte: maxP };

    const minM = Number(minMileage);
    const maxM = Number(maxMileage);
    if (Number.isFinite(minM))
      postMatch.mileageNum = { ...(postMatch.mileageNum || {}), $gte: minM };
    if (Number.isFinite(maxM))
      postMatch.mileageNum = { ...(postMatch.mileageNum || {}), $lte: maxM };

    if (hasImages === "1" || hasImages === "true") postMatch.imagesCount = { $gte: 1 };

    const rows = await YallaModel.aggregate(
      [
        { $match: match },
        {
          $addFields: {
            brandX: getBrandExpr(),
            modelX: getModelExpr(),
            yearX: getYearExpr(),
            cityX: getCityExpr(),

            // ✅ SAFE numeric parsing (fixes your error)
            priceNum: toIntSafeExpr({
              $ifNull: ["$detail.priceBox.priceText", "$cardPriceText"],
            }),
            mileageNum: toIntSafeExpr("$detail.importantSpecs.عدد الكيلومترات"),

            imagesCount: { $size: { $ifNull: ["$detail.images", []] } },
          },
        },
        Object.keys(postMatch).length ? { $match: postMatch } : null,
        {
          $facet: {
            brands: [
              { $match: { brandX: { $type: "string", $ne: "" } } },
              { $group: { _id: "$brandX", count: { $sum: 1 } } },
              { $sort: { count: -1, _id: 1 } },
            ],
            models: [
              { $match: { modelX: { $type: "string", $ne: "" } } },
              { $group: { _id: "$modelX", count: { $sum: 1 } } },
              { $sort: { count: -1, _id: 1 } },
            ],
            years: [
              { $match: { yearX: { $type: "string", $ne: "" } } },
              { $group: { _id: "$yearX", count: { $sum: 1 } } },
              { $sort: { _id: -1 } },
            ],
            cities: [
              { $match: { cityX: { $type: "string", $ne: "" } } },
              { $group: { _id: "$cityX", count: { $sum: 1 } } },
              { $sort: { count: -1, _id: 1 } },
            ],
          },
        },
        {
          $project: {
            brands: {
              $map: {
                input: "$brands",
                as: "x",
                in: { brand: "$$x._id", count: "$$x.count" },
              },
            },
            models: {
              $map: {
                input: "$models",
                as: "x",
                in: { model: "$$x._id", count: "$$x.count" },
              },
            },
            years: {
              $map: {
                input: "$years",
                as: "x",
                in: { year: "$$x._id", count: "$$x.count" },
              },
            },
            cities: {
              $map: {
                input: "$cities",
                as: "x",
                in: { city: "$$x._id", count: "$$x.count" },
              },
            },
          },
        },
      ].filter(Boolean)
    ).allowDiskUse(true);

    res.json({ success: true, ...(rows[0] || { brands: [], models: [], years: [], cities: [] }) });
  } catch (e) {
    res
      .status(500)
      .json({ success: false, message: e.message || String(e) });
  }
};
