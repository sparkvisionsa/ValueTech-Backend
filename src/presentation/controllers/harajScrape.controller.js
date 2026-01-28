const HarajScrape = require("../../infrastructure/models/harajScrape.model");

async function getHarajScrapeList(req, res) {
  try {
    const {
      q,
      tag,
      tags,
      hasPrice,
      minPrice,
      maxPrice,
      city,
      sort = "postDate",
      order = "desc",
      page = 1,
      limit = 20,
    } = req.query;

    const filter = {};

    if (q && String(q).trim()) {
      filter.title = { $regex: String(q).trim(), $options: "i" };
    }

    if (tag && String(tag).trim()) {
      filter.tags = String(tag).trim();
    }

    if (!filter.tags && tags) {
      const arr = String(tags)
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
      if (arr.length) filter.tags = { $in: arr };
    }

    if (city && String(city).trim()) {
      filter.city = String(city).trim();
    }

    if (hasPrice === "true") filter.hasPrice = true;
    if (hasPrice === "false") filter.hasPrice = false;

    if (minPrice || maxPrice) {
      filter.priceNumeric = {};
      if (minPrice) filter.priceNumeric.$gte = Number(minPrice);
      if (maxPrice) filter.priceNumeric.$lte = Number(maxPrice);
    }

    const dir = order === "asc" ? 1 : -1;
    const sortMap = {
      postDate: "postDate",
      firstSeenAt: "firstSeenAt",
      lastSeenAt: "lastSeenAt",
      createdAt: "createdAt",
    };
    const sortField = sortMap[sort] || "postDate";

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(100, Math.max(1, Number(limit) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [items, total] = await Promise.all([
      HarajScrape.find(filter)
        .sort({ [sortField]: dir })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      HarajScrape.countDocuments(filter),
    ]);

    res.json({ success: true, page: pageNum, limit: limitNum, total, items });
  } catch (err) {
    console.error("getHarajScrapeList error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

async function getHarajScrapeById(req, res) {
  try {
    const item = await HarajScrape.findById(req.params.id).lean();
    if (!item) {
      return res.status(404).json({ success: false, message: "Not found" });
    }
    res.json({ success: true, item });
  } catch (err) {
    console.error("getHarajScrapeById error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

async function getHarajScrapeTags(req, res) {
  try {
    const limitNum = Math.min(200, Math.max(1, Number(req.query.limit) || 50));

    const items = await HarajScrape.aggregate([
      { $match: { tags: { $exists: true, $ne: [] } } },
      { $unwind: "$tags" },
      { $group: { _id: "$tags", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: limitNum },
      { $project: { _id: 0, tag: "$_id", count: 1 } },
    ]);

    res.json({ success: true, items });
  } catch (err) {
    console.error("getHarajScrapeTags error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

module.exports = {
  getHarajScrapeList,
  getHarajScrapeById,
  getHarajScrapeTags,
};
