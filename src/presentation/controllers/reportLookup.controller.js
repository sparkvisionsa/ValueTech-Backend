const mongoose = require("mongoose");

const DuplicateReport = require("../../infrastructure/models/DuplicateReport.js");
const ElrajhiReport = require("../../infrastructure/models/ElrajhiReport.js");
const MultiApproachReport = require("../../infrastructure/models/MultiApproachReport.js");
const SubmitReportsQuickly = require("../../infrastructure/models/SubmitReportsQuickly.js");
const UrgentReport = require("../../infrastructure/models/UrgentReport.js");
const Reports = require("../../infrastructure/models/report.js");

function normalizeReport(doc, source) {
  return {
    source,
    _id: doc._id,
    report_id: doc.report_id ?? doc.reportId ?? null,
    title: doc.title ?? doc.report_title ?? doc.name ?? null,
    user_id: doc.user_id ?? null,
    company: doc.company ?? null,
    createdAt: doc.createdAt ?? null,
    updatedAt: doc.updatedAt ?? null,
    raw: doc,
  };
}

async function lookupReportByReportId(req, res) {
  try {
    const userIdStr = req.userId; // ✅ from your middleware

    if (!userIdStr || !mongoose.Types.ObjectId.isValid(userIdStr)) {
      return res.status(401).json({ status: "failed", error: "Unauthorized" });
    }

    const userObjectId = new mongoose.Types.ObjectId(userIdStr);

    const reportId = String(req.query.report_id || "").trim();
    if (!reportId) {
      return res.status(400).json({ status: "failed", error: "report_id is required" });
    }

    const sources = [
      { name: "DuplicateReport", model: DuplicateReport, idKey: "report_id" },
      { name: "ElrajhiReport", model: ElrajhiReport, idKey: "report_id" },
      { name: "MultiApproachReport", model: MultiApproachReport, idKey: "report_id" },
      { name: "SubmitReportsQuickly", model: SubmitReportsQuickly, idKey: "report_id" },
      { name: "UrgentReport", model: UrgentReport, idKey: "report_id" },
      { name: "Reports", model: Reports, idKey: "report_id" },
    ];

    for (const s of sources) {
      const doc = await s.model
        .findOne({ [s.idKey]: reportId, user_id: userObjectId })
        .lean()
        .exec();

      if (doc) {
        return res.json({ status: "success", data: normalizeReport(doc, s.name) });
      }
    }

    return res.status(404).json({
      status: "failed",
      error: "Report not found for this user in any collection",
    });
  } catch (err) {
    console.error("lookupReportByReportId error:", err);
    return res.status(500).json({ status: "failed", error: err.message || "Server error" });
  }
}

async function listMyReports(req, res) {
  try {
    const userIdStr = String(req.userId || "").trim();
    console.log("[REPORT_LOOKUP] listMyReports called");
    console.log("[REPORT_LOOKUP] req.userId:", req.userId, "as string:", userIdStr);

    if (!userIdStr || !mongoose.Types.ObjectId.isValid(userIdStr)) {
      console.log("[REPORT_LOOKUP] Unauthorized: invalid userId");
      return res.status(401).json({ status: "failed", error: "Unauthorized" });
    }

    const userObjectId = new mongoose.Types.ObjectId(userIdStr);

    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const skip = (page - 1) * limit;

    console.log("[REPORT_LOOKUP] pagination:", { page, limit, skip });

    // ✅ match user across collections (ObjectId or string, user_id or userId)
    const userMatch = {
      $or: [
        { user_id: userObjectId },
        { user_id: userIdStr },
        { userId: userObjectId },
        { userId: userIdStr },
      ],
    };

    // ✅ collection names that $unionWith will use
   const COLS = [
  { key: "UrgentReport", label: "Upload Report (ElRajhi)", coll: UrgentReport.collection.name, model: UrgentReport },
  { key: "DuplicateReport", label: "Upload Manual Report", coll: DuplicateReport.collection.name, model: DuplicateReport },
  { key: "MultiApproachReport", label: "Multi Excel Upload", coll: MultiApproachReport.collection.name, model: MultiApproachReport },
  { key: "SubmitReportsQuickly", label: "Submit Reports Quickly", coll: SubmitReportsQuickly.collection.name, model: SubmitReportsQuickly },
  { key: "Reports", label: "Upload Assets", coll: Reports.collection.name, model: Reports },
];


    console.log(
      "[REPORT_LOOKUP] collections used:",
      COLS.map((c) => ({ label: c.label, coll: c.coll }))
    );

    // ✅ debug: counts per collection with BOTH matches (ObjectId + string)
    // (this tells you immediately which collection doesn't match your user_id type/field)
    const counts = {};
    await Promise.all(
      COLS.map(async (c) => {
        try {
          const n = await c.model.countDocuments(userMatch);
          counts[c.label] = n;
        } catch (e) {
          counts[c.label] = `count_failed: ${e.message}`;
        }
      })
    );
    console.log("[REPORT_LOOKUP] counts per collection:", counts);

    const makeProject = (key, label) => ({
      $project: {
        sourceKey: { $literal: key },     // stable key for filtering
        sourceLabel: { $literal: label }, // UI display label

        _id: 1,
        report_id: { $ifNull: ["$report_id", "$reportId"] },
        title: { $ifNull: ["$title", "$report_title"] },
        user_id: 1,
        userId: 1,
        company: 1,
        createdAt: 1,
        updatedAt: 1,

        // ✅ stable date for sorting even if createdAt is missing
        createdAtSafe: {
          $ifNull: ["$createdAt", { $ifNull: ["$updatedAt", { $toDate: "$_id" }] }],
        },

        raw: "$$ROOT",
      },
    });

    const makeUnion = (label, collName) => ({
      $unionWith: {
        coll: collName,
        pipeline: [{ $match: userMatch }, makeProject(label)],
      },
    });

    const [first, ...rest] = COLS;

    const pipeline = [
      // base is UrgentReport because we run aggregate on UrgentReport model
      { $match: userMatch },
      makeProject(first.label),

      // union others
      ...rest.map((c) => makeUnion(c.label, c.coll)),

      // ✅ global ordering by createdAtSafe
      { $sort: { createdAtSafe: -1, _id: -1 } },

      // ✅ total + paginated data
      {
        $facet: {
          data: [{ $skip: skip }, { $limit: limit }],
          meta: [{ $count: "total" }],
        },
      },
      {
        $addFields: {
          total: { $ifNull: [{ $arrayElemAt: ["$meta.total", 0] }, 0] },
        },
      },
      { $project: { data: 1, total: 1 } },
    ];

    console.log("[REPORT_LOOKUP] aggregation pipeline built");

    const agg = await UrgentReport.aggregate(pipeline).allowDiskUse(true);
    const out = agg?.[0] || { data: [], total: 0 };

    console.log("[REPORT_LOOKUP] aggregation result:", {
      total: out.total,
      returned: out.data?.length || 0,
    });

    // ✅ debug: how many of returned rows from each source (page-level distribution)
    const pageDist = {};
    for (const row of out.data || []) {
      pageDist[row.source] = (pageDist[row.source] || 0) + 1;
    }
    console.log("[REPORT_LOOKUP] page distribution:", pageDist);

    return res.json({
      status: "success",
      page,
      limit,
      total: out.total,
      debug: {
        counts,
        pageDist,
        collectionsUsed: COLS.map((c) => ({ label: c.label, coll: c.coll })),
      },
      data: out.data,
    });
  } catch (err) {
    console.error("[REPORT_LOOKUP] listMyReports error:", err);
    return res.status(500).json({ status: "failed", error: err.message || "Server error" });
  }
}



module.exports = {
  lookupReportByReportId,
  listMyReports,
};
