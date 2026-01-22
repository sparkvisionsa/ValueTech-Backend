const xlsx = require("xlsx");
const DuplicateReport = require("../../infrastructure/models/DuplicateReport");
const Report = require("../../infrastructure/models/report");
const ElrajhiReport = require("../../infrastructure/models/ElrajhiReport");
const UrgentReport = require("../../infrastructure/models/UrgentReport");
const path = require("path");
const { createNotification } = require("../../application/services/notification/notification.service");


const normalizeKey = (value = "") =>
  value
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[\s_\-]+/g, "");

const asDateString = (value) => {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
};

const toBool = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return ["true", "1", "yes", "on"].includes(value.trim().toLowerCase());
  }
  return false;
};

const cleanArray = (value) => {
  if (Array.isArray(value)) return value.filter((v) => v !== undefined && v !== null && v !== "");
  if (typeof value === "string" && value.trim()) {
    return value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
};

const mapDocToForm = (doc) => ({
  report_id: doc.report_id || doc.batch_id || (doc._id ? doc._id.toString() : ""),
  title: doc.title || "",
  purpose_id: doc.purpose_id !== undefined && doc.purpose_id !== null ? String(doc.purpose_id) : "to set",
  value_premise_id: doc.value_premise_id !== undefined && doc.value_premise_id !== null ? String(doc.value_premise_id) : "to set",
  report_type: doc.report_type || "",
  valued_at: asDateString(doc.valued_at),
  submitted_at: asDateString(doc.submitted_at),
  assumptions: doc.assumptions !== undefined && doc.assumptions !== null ? String(doc.assumptions) : "",
  special_assumptions: doc.special_assumptions !== undefined && doc.special_assumptions !== null ? String(doc.special_assumptions) : "",
  value: doc.value !== undefined && doc.value !== null ? String(doc.value) : doc.final_value !== undefined && doc.final_value !== null ? String(doc.final_value) : "",
  client_name: doc.client_name || "",
  owner_name: doc.owner_name || "",
  telephone: doc.telephone || doc.user_phone || "",
  email: doc.email || "",
  inspection_date: asDateString(doc.inspection_date),
  valuation_currency: doc.valuation_currency !== undefined && doc.valuation_currency !== null ? String(doc.valuation_currency) : "to set",
  has_other_users: !!doc.has_other_users,
  report_users: doc.report_users || [],
});

const buildUserFilter = (user = {}) => {
  const clauses = [];
  if (user.id) clauses.push({ user_id: user.id });
  if (user.phone) {
    clauses.push({ user_phone: user.phone });
    clauses.push({ telephone: user.phone });
  }
  if (user.company) clauses.push({ company: user.company });
  return clauses.length ? { $or: clauses } : {};
};

const normalizeRowKeys = (row) => {
  const normalized = {};
  Object.keys(row || {}).forEach((key) => {
    normalized[normalizeKey(key)] = row[key];
  });
  return normalized;
};

const extractAssetsFromExcel = (excelPath, defaults = {}) => {
  const workbook = xlsx.readFile(excelPath);
  const sheetsToRead = ["market", "cost"];
  const assets = [];

  for (const sheetName of sheetsToRead) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const rows = xlsx.utils.sheet_to_json(sheet, { defval: "" });

    rows.forEach((row) => {
      const normalized = normalizeRowKeys(row);
      const assetName = normalized.assetname || normalized.asset || normalized.assetnamear || "";
      const finalValue = normalized.finalvalue || normalized["final value"] || "";
      const assetUsageId = normalized.assetusageid || normalized.asset_usage_id || normalized.usageid || "";
      const region = normalized.region || normalized.regionname || "";
      const city = normalized.city || normalized.cityname || "";
      const assetId = normalized.id || normalized.assetid || "";

      if (!assetName) {
        return;
      }

      const isMarket = sheetName === "market";
      const isCost = sheetName === "cost";

      const asset = {
        id: assetId ? String(assetId) : undefined,
        asset_type: "0",
        asset_name: String(assetName),
        inspection_date: defaults.inspection_date || "",
        owner_name: defaults.owner_name || "",
        submitState: 0,
        final_value: finalValue !== undefined && finalValue !== null ? String(finalValue) : "",
        asset_usage_id: assetUsageId ? String(assetUsageId) : "",
        value_base: 1,
        production_capacity: "0",
        production_capacity_measuring_unit: "0",
        product_type: "0",
        market_approach: isMarket ? 1 : undefined,
        market_approach_value: isMarket ? (finalValue !== undefined && finalValue !== null ? String(finalValue) : "") : undefined,
        cost_approach: isCost ? 1 : undefined,
        cost_approach_value: isCost ? (finalValue !== undefined && finalValue !== null ? String(finalValue) : "") : undefined,
        country: "المملكة العربية السعودية",
        region: region ? String(region) : "",
        city: city ? String(city) : "",
      };

      assets.push(asset);
    });
  }

  return assets;
};

const sanitizeValuers = (valuers = []) => {
  if (!Array.isArray(valuers)) return [];
  return valuers
    .map((valuer) => ({
      valuer_name: valuer.valuer_name || valuer.valuerName || "",
      contribution_percentage: Number(valuer.contribution_percentage ?? valuer.percentage ?? 0),
    }))
    .filter((valuer) => valuer.valuer_name);
};

const buildUserReportQuery = (user, reportId) => {
  const filter = buildUserFilter(user || {});
  if (!Object.keys(filter).length) return null;
  if (reportId) {
    return { _id: reportId, ...filter };
  }
  return filter;
};

exports.getLatestForUser = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const filter = buildUserFilter(req.user || {});

    const candidates = [];
    const [regular, elrajhi, urgent] = await Promise.all([
      Report.findOne(filter).sort({ createdAt: -1, _id: -1 }),
      ElrajhiReport.findOne(filter).sort({ createdAt: -1, _id: -1 }),
      UrgentReport.findOne(filter).sort({ createdAt: -1, _id: -1 }),
    ]);

    const pushCandidate = (doc, source) => {
      if (!doc) return;
      const ts = doc.createdAt || doc.updatedAt || (doc._id && doc._id.getTimestamp && doc._id.getTimestamp());
      candidates.push({
        source,
        doc,
        createdAt: ts ? new Date(ts) : new Date(),
      });
    };

    pushCandidate(regular, "reports");
    pushCandidate(elrajhi, "elrajhireports");
    pushCandidate(urgent, "urgentreports");

    if (!candidates.length) {
      return res.status(404).json({ success: false, message: "No reports found for this user." });
    }

    const latest = candidates.sort((a, b) => b.createdAt - a.createdAt)[0];

    return res.json({
      success: true,
      source: latest.source,
      data: mapDocToForm(latest.doc),
    });
  } catch (error) {
    console.error("Error fetching latest report for user:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.listReportsForUser = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const baseQuery = buildUserReportQuery(req.user);
    if (!baseQuery) {
      return res.status(401).json({ success: false, message: "User context missing." });
    }

    // -------- pagination params --------
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limitRaw = parseInt(req.query.limit, 10) || 10;
    const limit = Math.min(Math.max(limitRaw, 1), 200); // cap to protect server
    const skip = (page - 1) * limit;

    // -------- status filter (matches frontend getReportStatus) --------
    // getReportStatus:
    //  - approved: checked === true
    //  - complete: endSubmitTime exists
    //  - sent: report_id exists
    //  - incomplete: otherwise
    const status = String(req.query.status || "all").toLowerCase();

    const query = { ...baseQuery };

    if (status !== "all") {
      if (status === "approved") {
        query.checked = true;
      } else if (status === "complete") {
        query.checked = { $ne: true };
        query.endSubmitTime = { $exists: true, $ne: null };
      } else if (status === "sent") {
        query.checked = { $ne: true };
        query.endSubmitTime = { $exists: false };
        query.report_id = { $exists: true, $ne: "" };
      } else if (status === "incomplete") {
        query.checked = { $ne: true };
        query.endSubmitTime = { $exists: false };
        query.$or = [
          { report_id: { $exists: false } },
          { report_id: "" },
          { report_id: null },
        ];
      }
    }

    // -------- sort latest first --------
    const sort = { createdAt: -1, _id: -1 };

    // -------- fetch + count in parallel --------
    const [reports, total] = await Promise.all([
      DuplicateReport.find(query).sort(sort).skip(skip).limit(limit),
      DuplicateReport.countDocuments(query),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));

    return res.json({
      success: true,
      reports,
      pagination: {
        total,
        page,
        limit,
        totalPages,
        hasPrev: page > 1,
        hasNext: page < totalPages,
      },
    });
  } catch (error) {
    console.error("Error listing duplicate reports:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};


exports.updateDuplicateReport = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const reportId = req.params.id;
    const query = buildUserReportQuery(req.user, reportId);
    if (!query) {
      return res.status(401).json({ success: false, message: "User context missing." });
    }

    const report = await DuplicateReport.findOne(query);
    if (!report) {
      return res.status(404).json({ success: false, message: "Report not found." });
    }

    const updates = {};
    const allowedFields = [
      "report_id",
      "title",
      "purpose_id",
      "value_premise_id",
      "report_type",
      "valued_at",
      "submitted_at",
      "inspection_date",
      "assumptions",
      "special_assumptions",
      "value",
      "valuation_currency",
      "owner_name",
      "client_name",
      "telephone",
      "email",
    ];

    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    if (req.body.has_other_users !== undefined) {
      updates.has_other_users = toBool(req.body.has_other_users);
    }
    if (req.body.report_users !== undefined) {
      updates.report_users = cleanArray(req.body.report_users);
    }
    if (req.body.valuers !== undefined) {
      updates.valuers = sanitizeValuers(req.body.valuers);
    }
    if (req.body.checked !== undefined) {
      updates.checked = toBool(req.body.checked);
    }

    Object.assign(report, updates);
    await report.save();

    return res.json({ success: true, report });
  } catch (error) {
    console.error("Error updating duplicate report:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteDuplicateReport = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const reportId = req.params.id;
    const query = buildUserReportQuery(req.user, reportId);
    if (!query) {
      return res.status(401).json({ success: false, message: "User context missing." });
    }

    const result = await DuplicateReport.deleteOne(query);
    if (!result.deletedCount) {
      return res.status(404).json({ success: false, message: "Report not found." });
    }

    try {
      await createNotification({
        userId: req.user?.id,
        type: "report",
        level: "danger",
        title: "Report deleted",
        message: `Report ${reportId} was deleted.`,
        data: {
          reportId,
          view: "duplicate-report",
          action: "deleted"
        }
      });
    } catch (notifyError) {
      console.warn("Failed to create delete notification", notifyError);
    }

    return res.json({ success: true });
  } catch (error) {
    console.error("Error deleting duplicate report:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateDuplicateReportAsset = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const reportId = req.params.id;
    const assetIndex = Number(req.params.index);
    if (!Number.isInteger(assetIndex) || assetIndex < 0) {
      return res.status(400).json({ success: false, message: "Invalid asset index." });
    }

    const query = buildUserReportQuery(req.user, reportId);
    if (!query) {
      return res.status(401).json({ success: false, message: "User context missing." });
    }

    const report = await DuplicateReport.findOne(query);
    if (!report) {
      return res.status(404).json({ success: false, message: "Report not found." });
    }

    if (!Array.isArray(report.asset_data) || assetIndex >= report.asset_data.length) {
      return res.status(400).json({ success: false, message: "Asset index out of range." });
    }

    const asset = report.asset_data[assetIndex];
    const updates = {};
    const allowedFields = ["asset_name", "asset_usage_id", "final_value", "region", "city"];

    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    const normalized = asset?.toObject ? asset.toObject() : { ...asset };
    report.asset_data[assetIndex] = { ...normalized, ...updates };
    await report.save();

    return res.json({ success: true, asset: report.asset_data[assetIndex] });
  } catch (error) {
    console.error("Error updating duplicate report asset:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteDuplicateReportAsset = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const reportId = req.params.id;
    const assetIndex = Number(req.params.index);
    if (!Number.isInteger(assetIndex) || assetIndex < 0) {
      return res.status(400).json({ success: false, message: "Invalid asset index." });
    }

    const query = buildUserReportQuery(req.user, reportId);
    if (!query) {
      return res.status(401).json({ success: false, message: "User context missing." });
    }

    const report = await DuplicateReport.findOne(query);
    if (!report) {
      return res.status(404).json({ success: false, message: "Report not found." });
    }

    if (!Array.isArray(report.asset_data) || assetIndex >= report.asset_data.length) {
      return res.status(400).json({ success: false, message: "Asset index out of range." });
    }

    report.asset_data.splice(assetIndex, 1);
    await report.save();

    return res.json({ success: true });
  } catch (error) {
    console.error("Error deleting duplicate report asset:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.createDuplicateReport = async (req, res) => {
  try {
    const user = req.user || {};
    if (!user.id && !user.phone) {
      return res.status(401).json({ success: false, message: "User context missing." });
    }

    const excelPath = req.files?.excel?.[0]?.path;
    if (!excelPath) {
      return res.status(400).json({ success: false, message: "Excel file is required." });
    }

    const pdfFile = req.files?.pdf?.[0];
    const pdfPath = pdfFile ? path.resolve(pdfFile.path) : "";

    console.log("pdfPath", pdfPath, "pdfFile", pdfFile);

    let payload = req.body || {};
    if (payload.formData) {
      try {
        payload = JSON.parse(payload.formData);
      } catch (err) {
        return res.status(400).json({ success: false, message: "Invalid formData payload." });
      }
    }

    const assets = extractAssetsFromExcel(excelPath, {
      owner_name: payload.client_name || payload.owner_name || "",
      inspection_date: payload.inspection_date || "",
    });

    if (!assets.length) {
      return res.status(400).json({ success: false, message: "No assets found in provided excel file." });
    }

    const valuers = sanitizeValuers(payload.valuers);

    const duplicateReport = new DuplicateReport({
      user_id: user.id,
      user_phone: user.phone,
      company: user.company || null,
      report_id: payload.report_id || payload.reportId || "",
      title: payload.title || "",
      purpose_id: payload.purpose_id || "to set",
      value_premise_id: payload.value_premise_id || "to set",
      report_type: payload.report_type || "",
      valued_at: payload.valued_at || "",
      submitted_at: payload.submitted_at || "",
      assumptions: payload.assumptions || "",
      special_assumptions: payload.special_assumptions || "",
      value: payload.value || "",
      valuation_currency: payload.valuation_currency || "to set",
      owner_name: payload.owner_name || "",
      pdf_path: pdfPath,
      client_name: payload.client_name || "",
      telephone: payload.telephone || payload.phone || user.phone || "",
      email: payload.email || "",
      has_other_users: toBool(payload.has_other_users),
      report_users: cleanArray(payload.report_users),
      valuers,
      startSubmitTime: new Date(),
      asset_data: assets,
    });

    await duplicateReport.save();

    try {
      await createNotification({
        userId: user.id,
        type: "report",
        level: "success",
        title: "Report stored",
        message: `Report ${duplicateReport.report_id || duplicateReport._id.toString()} stored successfully.`,
        data: {
          reportId: duplicateReport._id.toString(),
          view: "duplicate-report",
          action: "created"
        }
      });
    } catch (notifyError) {
      console.warn("Failed to create report notification", notifyError);
    }

    return res.status(201).json({
      success: true,
      message: "Duplicate report stored.",
      data: { id: duplicateReport._id, report_id: duplicateReport.report_id },
    });
  } catch (error) {
    console.error("Error creating duplicate report:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};



exports.createDuplicateReport = async (req, res) => {
  try {
    const fs = require("fs");

    const user = req.user || {};
    if (!user.id && !user.phone) {
      return res
        .status(401)
        .json({ success: false, message: "User context missing." });
    }

    // excel is REQUIRED
    const excelPath = req.files?.excel?.[0]?.path;
    if (!excelPath) {
      return res
        .status(400)
        .json({ success: false, message: "Excel file is required." });
    }

    /**
     * pdf is OPTIONAL from frontend:
     * - if provided => use uploaded pdf path
     * - if not provided => use dummy pdf at uploads/static/dummy_placeholder.pdf
     */
    const pdfFile = req.files?.pdf?.[0];

    // IMPORTANT: use your requested path: \uploads\static\dummy_placeholder.pdf
    // Using process.cwd() so it resolves from project root regardless of OS.
    const dummyPdfPath = path.resolve(
      process.cwd(),
      "uploads",
      "static",
      "dummy_placeholder.pdf"
    );

    // If user didn't upload pdf, fallback to dummy
    if (!pdfFile && !fs.existsSync(dummyPdfPath)) {
      return res.status(500).json({
        success: false,
        message:
          'Dummy PDF not found on server at "uploads/static/dummy_placeholder.pdf".',
      });
    }

    // Decide final pdf path (real upload OR dummy)
    const pdfPath = pdfFile ? path.resolve(pdfFile.path) : dummyPdfPath;

    console.log("pdfPath", pdfPath, "pdfFile", pdfFile);

    // Parse formData JSON if provided
    let payload = req.body || {};
    if (payload.formData) {
      try {
        payload = JSON.parse(payload.formData);
      } catch (err) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid formData payload." });
      }
    }

    // Build assets from excel
    const assets = extractAssetsFromExcel(excelPath, {
      owner_name: payload.client_name || payload.owner_name || "",
      inspection_date: payload.inspection_date || "",
    });

    if (!assets.length) {
      return res.status(400).json({
        success: false,
        message: "No assets found in provided excel file.",
      });
    }

    const valuers = sanitizeValuers(payload.valuers);

    const duplicateReport = new DuplicateReport({
      user_id: user.id,
      user_phone: user.phone,
      company: user.company || null,

      report_id: payload.report_id || payload.reportId || "",
      title: payload.title || "",
      purpose_id: payload.purpose_id || "to set",
      value_premise_id: payload.value_premise_id || "to set",
      report_type: payload.report_type || "",
      valued_at: payload.valued_at || "",
      submitted_at: payload.submitted_at || "",
      assumptions: payload.assumptions || "",
      special_assumptions: payload.special_assumptions || "",
      value: payload.value || "",
      valuation_currency: payload.valuation_currency || "to set",
      owner_name: payload.owner_name || "",

      // ✅ ALWAYS set pdf_path:
      // - real uploaded pdf path if provided
      // - dummy placeholder path if not provided
      pdf_path: pdfPath,

      client_name: payload.client_name || "",
      telephone: payload.telephone || payload.phone || user.phone || "",
      email: payload.email || "",
      has_other_users: toBool(payload.has_other_users),
      report_users: cleanArray(payload.report_users),
      valuers,

      startSubmitTime: new Date(),
      asset_data: assets,
    });

    await duplicateReport.save();

    try {
      await createNotification({
        userId: user.id,
        type: "report",
        level: "success",
        title: "Report stored",
        message: `Report ${
          duplicateReport.report_id || duplicateReport._id.toString()
        } stored successfully.`,
        data: {
          reportId: duplicateReport._id.toString(),
          view: "duplicate-report",
          action: "created",
        },
      });
    } catch (notifyError) {
      console.warn("Failed to create report notification", notifyError);
    }

    return res.status(201).json({
      success: true,
      message: "Duplicate report stored.",
      data: { id: duplicateReport._id, report_id: duplicateReport.report_id },
    });
  } catch (error) {
    console.error("Error creating duplicate report:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

