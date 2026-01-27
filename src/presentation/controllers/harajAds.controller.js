const HarajAd = require("../../infrastructure/models/HarajAd");

const toInt = (v, def) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

const escapeRegex = (s = "") => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// GET /api/haraj-ads
// Query:
// q, city, author, status, hasPhone, minComments, maxComments, fromId, toId
// page, limit, sort (newest|oldest|adIdAsc|adIdDesc|commentsDesc)
exports.list = async (req, res) => {
  try {
    const {
      q = "",
      city,
      author,
      status,
      description,
      hasPhone,
      priceText,
      priceValue,
      minComments,
      maxComments,
      fromId,
      toId,
      path,
      crumb,
      sort = "newest",
    } = req.query;

    const page = Math.max(1, toInt(req.query.page, 1));
    const limit = Math.min(100, Math.max(1, toInt(req.query.limit, 20)));
    const skip = (page - 1) * limit;

    const filter = {};

    // Optional filters
    if (status) filter.status = status; // ACTIVE/REMOVED
    if (city) filter.city = new RegExp(`^${escapeRegex(city)}$`, "i");
    if (author) filter.author = new RegExp(escapeRegex(author), "i");
    if (priceValue) filter.priceValue = new RegExp(escapeRegex(priceValue), "i");
    if (priceText) filter.priceText = new RegExp(escapeRegex(priceText), "i");
    // ✅ Breadcrumb path filter: "حراج السيارات/مرسيدس/C"
const hasPath = path && String(path).trim();
const hasCrumb = crumb && String(crumb).trim();

// ✅ If path exists, use strict prefix drill-down
if (hasPath) {
  const p = String(path).trim();
  filter.breadcrumbKey = new RegExp(`^${escapeRegex(p)}(\\/|$)`);
}
// ✅ Else if crumb exists, match anywhere in breadcrumbNames
else if (hasCrumb) {
  filter.breadcrumbNames = String(crumb).trim();
}


 

    if (fromId || toId) {
      filter.adId = {};
      if (fromId) filter.adId.$gte = toInt(fromId, undefined);
      if (toId) filter.adId.$lte = toInt(toId, undefined);
    }

    if (hasPhone === "true") filter["contact.phone"] = { $exists: true, $ne: null, $ne: "" };
    if (hasPhone === "false") filter.$or = [
      { "contact.phone": { $exists: false } },
      { "contact.phone": null },
      { "contact.phone": "" },
    ];

    // Comments count filtering
    if (minComments || maxComments) {
      // Using $expr to compare array length
      const expr = [];
      if (minComments) expr.push({ $gte: [{ $size: "$comments" }, toInt(minComments, 0)] });
      if (maxComments) expr.push({ $lte: [{ $size: "$comments" }, toInt(maxComments, 0)] });
      filter.$expr = expr.length === 1 ? expr[0] : { $and: expr };
    }

    // Search
    let query = HarajAd.find(filter);

    if (q && q.trim()) {
      // Prefer text search if index exists
      query = HarajAd.find(
        { ...filter, $text: { $search: q.trim() } },
        { score: { $meta: "textScore" } }
      );
    }

    // Sorting
    const sortMap = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      adIdAsc: { adId: 1 },
      adIdDesc: { adId: -1 },
      commentsDesc: { "comments.length": -1 }, // not real field, handled below
    };

    let sortObj = sortMap[sort] || sortMap.newest;
    // If text search, sort by relevance first
    if (q && q.trim()) sortObj = { score: { $meta: "textScore" }, ...sortObj };

    // If you want sort by number of comments reliably:
    // use aggregation instead (below). For now, basic sorts.
    query = query.sort(sortObj).skip(skip).limit(limit);

    // Projection (list view)
    query = query.select([
      "adId",
      "url",
      "title",
      "city",
      "author",
      "priceText",
      "description",
      "priceValue",
      "status",
      "firstSeenAt",
      "lastSeenAt",
      "lastCommentsCheckAt",
      "createdAt",
      "updatedAt",
      "contact.phone",
      "comments", // we’ll slice in code
    ]);

    const [items, total] = await Promise.all([
      query.lean(),
      (q && q.trim()
        ? HarajAd.countDocuments({ ...filter, $text: { $search: q.trim() } })
        : HarajAd.countDocuments(filter)),
    ]);

    // Optional: only include last 3 comments preview for list
    const mapped = items.map((it) => ({
      ...it,
      commentsCount: it.comments?.length || 0,
      commentsPreview: (it.comments || []).slice(-3),
      comments: undefined,
    }));

    return res.json({
      success: true,
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
      items: mapped,
    });
  } catch (err) {
    console.error("harajAds.list error:", err);
    return res.status(500).json({ success: false, message: err.message || "Server error" });
  }
};

// GET /api/haraj-ads/:adId
exports.getOne = async (req, res) => {
  try {
    const adId = Number(req.params.adId);
    if (!Number.isFinite(adId)) {
      return res.status(400).json({ success: false, message: "Invalid adId" });
    }

    const doc = await HarajAd.findOne({ adId }).lean();
    if (!doc) return res.status(404).json({ success: false, message: "Not found" });

    return res.json({ success: true, item: doc });
  } catch (err) {
    console.error("harajAds.getOne error:", err);
    return res.status(500).json({ success: false, message: err.message || "Server error" });
  }
};

// GET /api/haraj-ads/:adId/comments
// Query: page, limit
exports.getComments = async (req, res) => {
  try {
    const adId = Number(req.params.adId);
    const page = Math.max(1, toInt(req.query.page, 1));
    const limit = Math.min(200, Math.max(1, toInt(req.query.limit, 50)));
    const skip = (page - 1) * limit;

    const doc = await HarajAd.findOne({ adId }).select(["adId", "comments"]).lean();
    if (!doc) return res.status(404).json({ success: false, message: "Not found" });

    const total = doc.comments?.length || 0;
    const items = (doc.comments || []).slice(skip, skip + limit);

    return res.json({
      success: true,
      adId,
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
      items,
    });
  } catch (err) {
    console.error("harajAds.getComments error:", err);
    return res.status(500).json({ success: false, message: err.message || "Server error" });
  }
};

// GET /api/haraj-ads/search/by-title
// Query: title, page, limit, sort, status
exports.searchByTitle = async (req, res) => {
  try {
    const {
      title = "",
      status,
      sort = "newest",
    } = req.query;

    const page = Math.max(1, toInt(req.query.page, 1));
    const limit = Math.min(100, Math.max(1, toInt(req.query.limit, 20)));
    const skip = (page - 1) * limit;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: "Title parameter is required" });
    }

    const filter = {
      title: new RegExp(escapeRegex(title.trim()), "i"),
    };

    if (status) filter.status = status;

    const sortMap = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      adIdAsc: { adId: 1 },
      adIdDesc: { adId: -1 },
    };

    const sortObj = sortMap[sort] || sortMap.newest;

    const [items, total] = await Promise.all([
      HarajAd.find(filter)
        .select([
          "adId",
          "url",
          "title",
          "city",
          "author",
          "priceText",
          "priceValue",
          "status",
          "firstSeenAt",
          "lastSeenAt",
          "lastCommentsCheckAt",
          "createdAt",
          "updatedAt",
          "contact.phone",
          "comments",
        ])
        .sort(sortObj)
        .skip(skip)
        .limit(limit)
        .lean(),
      HarajAd.countDocuments(filter),
    ]);

    const mapped = items.map((it) => ({
      ...it,
      commentsCount: it.comments?.length || 0,
      commentsPreview: (it.comments || []).slice(-3),
      comments: undefined,
    }));

    return res.json({
      success: true,
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
      items: mapped,
    });
  } catch (err) {
    console.error("harajAds.searchByTitle error:", err);
    return res.status(500).json({ success: false, message: err.message || "Server error" });
  }
};



// GET /api/haraj-ads/filters/options
// Query: path (optional), status (optional), limit (optional)
exports.getFilterOptions = async (req, res) => {
  try {
    const path = (req.query.path || "").trim(); // "حراج السيارات/مرسيدس"
    const status = (req.query.status || "ACTIVE").trim();
    const limit = Math.min(500, Math.max(1, toInt(req.query.limit, 200)));

    const segments = path
      ? path.split("/").map((s) => s.trim()).filter(Boolean)
      : [];

    const depth = segments.length; // next index in breadcrumbNames

    const match = {};
    if (status) match.status = status;

    if (segments.length) {
      match.breadcrumbKey = new RegExp(`^${escapeRegex(segments.join("/"))}(\\/|$)`);
    }

    const pipeline = [
      { $match: match },
      { $project: { next: { $arrayElemAt: ["$breadcrumbNames", depth] } } },
      { $match: { next: { $type: "string", $ne: "" } } },
      { $group: { _id: "$next", count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
      { $limit: limit },
    ];

    const rows = await HarajAd.aggregate(pipeline);

    return res.json({
      success: true,
      path: segments,
      depth,
      options: rows.map((r) => ({ value: r._id, count: r.count })),
    });
  } catch (err) {
    console.error("harajAds.getFilterOptions error:", err);
    return res.status(500).json({ success: false, message: err.message || "Server error" });
  }
};

