const xlsx = require("xlsx");
const DuplicateReport = require("../../infrastructure/models/DuplicateReport");
const Report = require("../../infrastructure/models/report");
const ElrajhiReport = require("../../infrastructure/models/ElrajhiReport");
const UrgentReport = require("../../infrastructure/models/UrgentReport");

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
      const region = normalized.region || "";
      const city = normalized.city || "";
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

    const valuers = Array.isArray(payload.valuers)
      ? payload.valuers
          .map((v) => ({
            valuer_name: v.valuer_name || v.valuerName || "",
            contribution_percentage: Number(v.contribution_percentage ?? v.percentage ?? 0),
          }))
          .filter((v) => v.valuer_name)
      : [];

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
      pdf_path: req.files?.pdf?.[0]?.path || "",
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
