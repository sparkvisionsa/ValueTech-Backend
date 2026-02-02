const Mobasher = require("../../infrastructure/models/mobasher.model");

function escapeRegex(s = "") {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildFilters(q) {
  const f = {};

  // brand
  if (q.brand) f["specs.نوع السيارة"] = new RegExp(`^${escapeRegex(String(q.brand).trim())}$`, "i");

  // model
  if (q.model) f["specs.طراز السيارة"] = new RegExp(`^${escapeRegex(String(q.model).trim())}$`, "i");

  // year
  if (q.year) f["specs.سنة الصنع"] = String(q.year).trim();

  // fuel
  if (q.fuel) f["specs.نوع الوقود"] = new RegExp(`^${escapeRegex(String(q.fuel).trim())}$`, "i");

  // price range
  const minPrice = q.minPrice != null ? Number(q.minPrice) : null;
  const maxPrice = q.maxPrice != null ? Number(q.maxPrice) : null;
  if (Number.isFinite(minPrice) || Number.isFinite(maxPrice)) {
    f.price = {};
    if (Number.isFinite(minPrice)) f.price.$gte = minPrice;
    if (Number.isFinite(maxPrice)) f.price.$lte = maxPrice;
  }

  return f;
}

// GET /api/mobasher
exports.getAllAds = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const skip = (page - 1) * limit;

    const filter = buildFilters(req.query);

    const [items, total] = await Promise.all([
      Mobasher.find(filter).sort({ scrapedAt: -1 }).skip(skip).limit(limit).lean(),
      Mobasher.countDocuments(filter),
    ]);

    return res.json({ page, limit, total, pages: Math.ceil(total / limit) || 0, items });
  } catch (err) {
    console.error("[getAllAds] Error:", err);
    return res.status(500).json({ success: false, message: err.message || String(err) });
  }
};

// GET /api/mobasher/:adId  (IMPORTANT: by adId)
exports.getByAdId = async (req, res) => {
  try {
    const { adId } = req.params;
    const ad = await Mobasher.findOne({ adId: String(adId).trim() }).lean();
    if (!ad) return res.status(404).json({ success: false, message: "Ad not found" });
    return res.json({ success: true, data: ad });
  } catch (err) {
    console.error("[getByAdId] Error:", err);
    return res.status(500).json({ success: false, message: err.message || String(err) });
  }
};

// GET /api/mobasher/search?query=مرسيدس&brand=مرسيدس&year=2025&model=C
exports.search = async (req, res) => {
  try {
    const query = String(req.query.query || "").trim();
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const skip = (page - 1) * limit;

    const filter = buildFilters(req.query);

    // if no query => behave like list with filters
    if (!query) {
      const [items, total] = await Promise.all([
        Mobasher.find(filter).sort({ scrapedAt: -1 }).skip(skip).limit(limit).lean(),
        Mobasher.countDocuments(filter),
      ]);
      return res.json({ page, limit, total, pages: Math.ceil(total / limit) || 0, items });
    }

    // Try text first
    let items = [];
    let total = 0;

    try {
      const textFilter = { ...filter, $text: { $search: query } };
      [items, total] = await Promise.all([
        Mobasher.find(textFilter, { score: { $meta: "textScore" } })
          .sort({ score: { $meta: "textScore" }, scrapedAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Mobasher.countDocuments(textFilter),
      ]);
    } catch {
      // ignore and fallback
    }

    // If text finds nothing, fallback to regex (IMPORTANT)
    if (!total) {
      const rx = new RegExp(escapeRegex(query), "i");
      const regexFilter = {
        ...filter,
        $or: [
          { title: rx },
          { description: rx },
          { "specs.نوع السيارة": rx },
          { "specs.طراز السيارة": rx },
          { "specs.سنة الصنع": rx },
          { adId: rx },
        ],
      };

      [items, total] = await Promise.all([
        Mobasher.find(regexFilter).sort({ scrapedAt: -1 }).skip(skip).limit(limit).lean(),
        Mobasher.countDocuments(regexFilter),
      ]);
    }

    return res.json({ page, limit, total, pages: Math.ceil(total / limit) || 0, items });
  } catch (err) {
    console.error("[search] Error:", err);
    return res.status(500).json({ success: false, message: err.message || String(err) });
  }
};

// GET /api/mobasher/stats
exports.stats = async (req, res) => {
  try {
    const [row] = await Mobasher.aggregate([
      {
        $group: {
          _id: null,
          totalAds: { $sum: 1 },
          avgPrice: { $avg: "$price" },
          minPrice: { $min: "$price" },
          maxPrice: { $max: "$price" },
        },
      },
    ]);

    return res.json({ success: true, data: row || { totalAds: 0, avgPrice: 0, minPrice: 0, maxPrice: 0 } });
  } catch (err) {
    console.error("[stats] Error:", err);
    return res.status(500).json({ success: false, message: err.message || String(err) });
  }
};
