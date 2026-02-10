const mongoose = require("mongoose");

const DuplicateReport = require("../../infrastructure/models/DuplicateReport.js");
const ElrajhiReport = require("../../infrastructure/models/ElrajhiReport.js");
const MultiApproachReport = require("../../infrastructure/models/MultiApproachReport.js");
const SubmitReportsQuickly = require("../../infrastructure/models/SubmitReportsQuickly.js");
const UrgentReport = require("../../infrastructure/models/UrgentReport.js");
const Reports = require("../../infrastructure/models/report.js");
const User = require("../../infrastructure/models/user.js");
const { extractCompanyOfficeId } = require("../utils/companyOffice");

const SOURCES = [
  { key: "UrgentReport", label: "Upload Report (ElRajhi)", model: UrgentReport },
  { key: "DuplicateReport", label: "Upload Manual Report", model: DuplicateReport },
  { key: "MultiApproachReport", label: "Multi Excel Upload", model: MultiApproachReport },
  { key: "SubmitReportsQuickly", label: "Submit Reports Quickly", model: SubmitReportsQuickly },
  { key: "Reports", label: "Upload Assets", model: Reports },
  { key: "ElrajhiReport", label: "Elrajhi Reports", model: ElrajhiReport },
];

function normalizeReport(doc, source) {
  return {
    sourceKey: source.key,
    sourceLabel: source.label,
    _id: doc._id,
    report_id: doc.report_id ?? doc.reportId ?? null,
    title: doc.title ?? doc.report_title ?? doc.name ?? null,
    user_id: doc.user_id ?? null,
    taqeem_user: doc.taqeem_user ?? null,
    company: doc.company ?? null,
    company_office_id: doc.company_office_id ?? null,
    createdAt: doc.createdAt ?? null,
    updatedAt: doc.updatedAt ?? null,
    raw: doc,
  };
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildSmartOr(query) {
  const maybeNumber = Number(query);
  const isNumber = !Number.isNaN(maybeNumber);
  const rx = new RegExp(escapeRegex(query), "i");

  const clauses = [
    { report_id: rx },
    { title: rx },
    { client_name: rx },
    { report_status: rx },
    { source_excel_name: rx },
    { asset_name: rx },
    { region: rx },
    { city: rx },
    { email: rx },
    { telephone: rx },
    { pdf_path: rx },
  ];

  if (isNumber) {
    clauses.push(
      { asset_id: maybeNumber },
      { purpose_id: maybeNumber },
      { value_premise_id: maybeNumber },
      { submit_state: maybeNumber },
      { final_value: maybeNumber },
    );
  }

  return clauses;
}

async function buildOwnerMatch(userIdRaw) {
  const userIdStr = String(userIdRaw || "").trim();
  if (!userIdStr || !mongoose.Types.ObjectId.isValid(userIdStr)) {
    return null;
  }

  const userObjectId = new mongoose.Types.ObjectId(userIdStr);
  const currentUser = await User.findById(userObjectId).select("taqeem.username").lean();
  const taqeemUser = String(currentUser?.taqeem?.username || "").trim();

  const clauses = [
    { user_id: userObjectId },
    { user_id: userIdStr },
    { userId: userObjectId },
    { userId: userIdStr },
  ];

  if (taqeemUser) {
    clauses.push({ taqeem_user: taqeemUser });
  }

  return clauses.length === 1 ? clauses[0] : { $or: clauses };
}

function buildCollectionMatch(ownerMatch, companyOfficeId, extraClauses = []) {
  const clauses = [ownerMatch, ...extraClauses];

  if (companyOfficeId) {
    clauses.push({ company_office_id: companyOfficeId });
  }

  return clauses.length === 1 ? clauses[0] : { $and: clauses };
}

function sortByCreatedAtDesc(a, b) {
  const aTime = a.createdAt
    ? new Date(a.createdAt).getTime()
    : a.updatedAt
    ? new Date(a.updatedAt).getTime()
    : 0;
  const bTime = b.createdAt
    ? new Date(b.createdAt).getTime()
    : b.updatedAt
    ? new Date(b.updatedAt).getTime()
    : 0;
  return bTime - aTime;
}

async function listSourceDocs({ source, match, fetchLimit }) {
  const [count, docs] = await Promise.all([
    source.model.countDocuments(match),
    source.model
      .find(match)
      .sort({ createdAt: -1, _id: -1 })
      .limit(fetchLimit)
      .lean(),
  ]);

  return {
    key: source.key,
    label: source.label,
    count,
    docs: docs.map((doc) => normalizeReport(doc, source)),
  };
}

async function searchReports(req, res) {
  try {
    const ownerMatch = await buildOwnerMatch(req.userId);
    if (!ownerMatch) {
      return res.status(401).json({ status: "failed", error: "Unauthorized" });
    }

    const q = String(req.query.q || "").trim();
    if (!q) {
      return res.status(400).json({ status: "failed", error: "q is required" });
    }

    const companyOfficeId = extractCompanyOfficeId(req);
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const skip = (page - 1) * limit;

    const sourceFilter = String(req.query.source || "ALL").trim();
    const sources = SOURCES.filter(
      (source) => sourceFilter === "ALL" || source.key === sourceFilter,
    );

    const searchClauses = buildSmartOr(q);
    const fetchLimit = skip + limit;

    const results = await Promise.all(
      sources.map((source) => {
        const match = buildCollectionMatch(ownerMatch, companyOfficeId, [{ $or: searchClauses }]);
        return listSourceDocs({ source, match, fetchLimit });
      }),
    );

    const merged = results.flatMap((item) => item.docs).sort(sortByCreatedAtDesc);
    const paged = merged.slice(skip, skip + limit);
    const total = results.reduce((sum, item) => sum + item.count, 0);

    return res.json({
      status: "success",
      q,
      page,
      limit,
      total,
      data: paged,
    });
  } catch (err) {
    console.error("searchReports error:", err);
    return res.status(500).json({ status: "failed", error: err.message || "Server error" });
  }
}

async function listMyReports(req, res) {
  try {
    const ownerMatch = await buildOwnerMatch(req.userId);
    if (!ownerMatch) {
      return res.status(401).json({ status: "failed", error: "Unauthorized" });
    }

    const companyOfficeId = extractCompanyOfficeId(req);
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const skip = (page - 1) * limit;
    const fetchLimit = skip + limit;

    const results = await Promise.all(
      SOURCES.map((source) => {
        const match = buildCollectionMatch(ownerMatch, companyOfficeId);
        return listSourceDocs({ source, match, fetchLimit });
      }),
    );

    const merged = results.flatMap((item) => item.docs).sort(sortByCreatedAtDesc);
    const paged = merged.slice(skip, skip + limit);
    const total = results.reduce((sum, item) => sum + item.count, 0);

    const counts = Object.fromEntries(results.map((item) => [item.label, item.count]));
    const pageDist = paged.reduce((acc, row) => {
      const key = row.sourceKey || "unknown";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    return res.json({
      status: "success",
      page,
      limit,
      total,
      debug: {
        counts,
        pageDist,
      },
      data: paged,
    });
  } catch (err) {
    console.error("[REPORT_LOOKUP] listMyReports error:", err);
    return res.status(500).json({ status: "failed", error: err.message || "Server error" });
  }
}

module.exports = {
  searchReports,
  listMyReports,
};
