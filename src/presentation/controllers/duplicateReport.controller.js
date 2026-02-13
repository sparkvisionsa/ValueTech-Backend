const xlsx = require("xlsx");
const DuplicateReport = require("../../infrastructure/models/DuplicateReport");
const Report = require("../../infrastructure/models/report");
const ElrajhiReport = require("../../infrastructure/models/ElrajhiReport");
const UrgentReport = require("../../infrastructure/models/UrgentReport");
const path = require("path");
const {
  createNotification,
} = require("../../application/services/notification/notification.service");
const { extractCompanyOfficeId } = require("../utils/companyOffice");

const normalizeKey = (value = "") =>
  value
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[\s_\-]+/g, "");

const stripExtension = (filename = "") => filename.replace(/\.[^.]+$/, "");

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
  if (Array.isArray(value))
    return value.filter((v) => v !== undefined && v !== null && v !== "");
  if (typeof value === "string" && value.trim()) {
    return value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
};

const mapDocToForm = (doc) => ({
  report_id:
    doc.report_id || doc.batch_id || (doc._id ? doc._id.toString() : ""),
  title: doc.title || "",
  purpose_id:
    doc.purpose_id !== undefined && doc.purpose_id !== null
      ? String(doc.purpose_id)
      : "to set",
  value_premise_id:
    doc.value_premise_id !== undefined && doc.value_premise_id !== null
      ? String(doc.value_premise_id)
      : "to set",
  report_type: doc.report_type || "",
  valued_at: asDateString(doc.valued_at),
  submitted_at: asDateString(doc.submitted_at),
  assumptions:
    doc.assumptions !== undefined && doc.assumptions !== null
      ? String(doc.assumptions)
      : "",
  special_assumptions:
    doc.special_assumptions !== undefined && doc.special_assumptions !== null
      ? String(doc.special_assumptions)
      : "",
  value:
    doc.value !== undefined && doc.value !== null
      ? String(doc.value)
      : doc.final_value !== undefined && doc.final_value !== null
        ? String(doc.final_value)
        : "",
  client_name: doc.client_name || "",
  owner_name: doc.owner_name || "",
  telephone: doc.telephone || doc.user_phone || "",
  email: doc.email || "",
  inspection_date: asDateString(doc.inspection_date),
  valuation_currency:
    doc.valuation_currency !== undefined && doc.valuation_currency !== null
      ? String(doc.valuation_currency)
      : "to set",
  has_other_users: !!doc.has_other_users,
  report_users: doc.report_users || [],
});

const buildUserFilter = (user = {}, options = {}) => {
  const clauses = [];
  if (user.id) clauses.push({ user_id: user.id });
  if (user._id) clauses.push({ user_id: user._id });
  if (user.taqeemUser) clauses.push({ taqeem_user: user.taqeemUser });
  if (user.company) clauses.push({ company: user.company });
  const filter = clauses.length ? { $or: clauses } : {};
  const officeId = options.companyOfficeId;
  if (officeId) {
    filter.company_office_id = officeId;
  }
  return filter;
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
      const assetName =
        normalized.assetname ||
        normalized.asset ||
        normalized.assetnamear ||
        "";
      const finalValue =
        normalized.finalvalue || normalized["final value"] || "";
      const assetUsageId =
        normalized.assetusageid ||
        normalized.asset_usage_id ||
        normalized.usageid ||
        "";
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
        final_value:
          finalValue !== undefined && finalValue !== null
            ? String(finalValue)
            : "",
        asset_usage_id: assetUsageId ? String(assetUsageId) : "",
        value_base: 1,
        production_capacity: "0",
        production_capacity_measuring_unit: "0",
        product_type: "0",
        market_approach: isMarket ? 1 : undefined,
        market_approach_value: isMarket
          ? finalValue !== undefined && finalValue !== null
            ? String(finalValue)
            : ""
          : undefined,
        cost_approach: isCost ? 1 : undefined,
        cost_approach_value: isCost
          ? finalValue !== undefined && finalValue !== null
            ? String(finalValue)
            : ""
          : undefined,
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
      contribution_percentage: Number(
        valuer.contribution_percentage ?? valuer.percentage ?? 0,
      ),
    }))
    .filter((valuer) => valuer.valuer_name);
};

const buildUserReportQuery = (user, reportId, options = {}) => {
  const filter = buildUserFilter(user || {}, options);
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
    const companyOfficeId = extractCompanyOfficeId(req);
    const filter = buildUserFilter(req.user || {}, { companyOfficeId });

    const candidates = [];
    const [regular, elrajhi, urgent] = await Promise.all([
      Report.findOne(filter).sort({ createdAt: -1, _id: -1 }),
      ElrajhiReport.findOne(filter).sort({ createdAt: -1, _id: -1 }),
      UrgentReport.findOne(filter).sort({ createdAt: -1, _id: -1 }),
    ]);

    const pushCandidate = (doc, source) => {
      if (!doc) return;
      const ts =
        doc.createdAt ||
        doc.updatedAt ||
        (doc._id && doc._id.getTimestamp && doc._id.getTimestamp());
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
      return res
        .status(404)
        .json({ success: false, message: "No reports found for this user." });
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

// exports.listReportsForUser = async (req, res) => {
//   try {
//     if (!req.user) {
//       // commit
//       return res.status(401).json({ success: false, message: "Unauthorized" });
//     }
//     const query = buildUserReportQuery(req.user);
//     if (!query) {
//       return res.status(401).json({ success: false, message: "User context missing." });
//     }

//     const limit = Math.min(Number(req.query.limit) || 200, 500);
//     const reports = await DuplicateReport.find(query)
//       .sort({ createdAt: -1, _id: -1 })
//       .limit(limit);

//     return res.json({ success: true, reports });
//   } catch (error) {
//     console.error("Error listing duplicate reports:", error);
//     return res.status(500).json({ success: false, message: error.message });
//   }
// };

exports.listReportsForUser = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const unassignedOnly = ["1", "true", "yes"].includes(
      String(req.query.unassigned || "")
        .trim()
        .toLowerCase(),
    );
    const companyOfficeId = unassignedOnly ? null : extractCompanyOfficeId(req);
    const baseQuery = buildUserReportQuery(req.user, null, { companyOfficeId });
    if (!baseQuery) {
      return res
        .status(401)
        .json({ success: false, message: "User context missing." });
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

    let query = { ...baseQuery };

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

    if (unassignedOnly) {
      query = {
        $and: [
          query,
          {
            $or: [
              { company_office_id: { $exists: false } },
              { company_office_id: null },
              { company_office_id: "" },
            ],
          },
        ],
      };
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
    const companyOfficeId = extractCompanyOfficeId(req);
    const query = buildUserReportQuery(req.user, reportId, { companyOfficeId });
    if (!query) {
      return res
        .status(401)
        .json({ success: false, message: "User context missing." });
    }

    const report = await DuplicateReport.findOne(query);
    if (!report) {
      return res
        .status(404)
        .json({ success: false, message: "Report not found." });
    }

    const updates = {};
    const allowedFields = [
      "company_office_id",
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
    const companyOfficeId = extractCompanyOfficeId(req);
    const query = buildUserReportQuery(req.user, reportId, { companyOfficeId });
    if (!query) {
      return res
        .status(401)
        .json({ success: false, message: "User context missing." });
    }

    const result = await DuplicateReport.deleteOne(query);
    if (!result.deletedCount) {
      return res
        .status(404)
        .json({ success: false, message: "Report not found." });
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
          action: "deleted",
        },
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
      return res
        .status(400)
        .json({ success: false, message: "Invalid asset index." });
    }

    const companyOfficeId = extractCompanyOfficeId(req);
    const query = buildUserReportQuery(req.user, reportId, { companyOfficeId });
    if (!query) {
      return res
        .status(401)
        .json({ success: false, message: "User context missing." });
    }

    const report = await DuplicateReport.findOne(query);
    if (!report) {
      return res
        .status(404)
        .json({ success: false, message: "Report not found." });
    }

    if (
      !Array.isArray(report.asset_data) ||
      assetIndex >= report.asset_data.length
    ) {
      return res
        .status(400)
        .json({ success: false, message: "Asset index out of range." });
    }

    const asset = report.asset_data[assetIndex];
    const updates = {};
    const allowedFields = [
      "asset_name",
      "asset_usage_id",
      "final_value",
      "region",
      "city",
    ];

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
      return res
        .status(400)
        .json({ success: false, message: "Invalid asset index." });
    }

    const companyOfficeId = extractCompanyOfficeId(req);
    const query = buildUserReportQuery(req.user, reportId, { companyOfficeId });
    if (!query) {
      return res
        .status(401)
        .json({ success: false, message: "User context missing." });
    }

    const report = await DuplicateReport.findOne(query);
    if (!report) {
      return res
        .status(404)
        .json({ success: false, message: "Report not found." });
    }

    if (
      !Array.isArray(report.asset_data) ||
      assetIndex >= report.asset_data.length
    ) {
      return res
        .status(400)
        .json({ success: false, message: "Asset index out of range." });
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
    const fs = require("fs");

    console.log("=".repeat(50));
    console.log("📄 DUPLICATE REPORT CREATION - PDF PATH DEBUG");
    console.log("=".repeat(50));

    const user = req.user || {};
    const companyOfficeId = extractCompanyOfficeId(req);
    if (!user.id && !user._id) {
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

    // Get skipPdfUpload flag from request body
    const skipPdfUpload =
      req.body.skipPdfUpload === "true" || req.body.skipPdfUpload === true;

    const pdfFile = req.files?.pdf?.[0];

    console.log("1️⃣ REQUEST BODY KEYS:", Object.keys(req.body));
    console.log("2️⃣ skipPdfUpload flag:", skipPdfUpload);
    console.log("3️⃣ PDF file uploaded:", !!pdfFile);
    if (pdfFile) {
      console.log("   - PDF filename:", pdfFile.originalname);
      console.log("   - PDF temp path:", pdfFile.path);
    }

    // CRITICAL: Log the exact value of req.body.pdfPath
    console.log("4️⃣ req.body.pdfPath value:", req.body.pdfPath);
    console.log("   - Type:", typeof req.body.pdfPath);
    console.log("   - Length:", req.body.pdfPath?.length);
    console.log("   - Is string:", typeof req.body.pdfPath === "string");
    console.log("   - Is undefined:", req.body.pdfPath === undefined);
    console.log("   - Is null:", req.body.pdfPath === null);
    console.log("   - Value (quoted):", `"${req.body.pdfPath}"`);

    // Backend dummy PDF path (fallback only)
    const dummyPdfPath = path.resolve(
      process.cwd(),
      "uploads",
      "static",
      "dummy_placeholder.pdf",
    );
    console.log("5️⃣ Backend dummy PDF path:", dummyPdfPath);
    console.log("   - Exists:", fs.existsSync(dummyPdfPath));

    // Determine PDF path - priority:
    // 1. Absolute path from request body (pdfPath) - this could be real PDF path OR bundled dummy PDF path
    // 2. Uploaded file path (if provided)
    // 3. Backend dummy path (only if skipPdfUpload is false and no other options)
    let pdfPath = null;
    let pathSource = "";

    // FIRST PRIORITY: Check if frontend sent an absolute path in req.body.pdfPath
    // log both dummy and normal path
    console.log("   - Frontend absolute path:", req.body.pdfPath);
    console.log("   - Backend dummy path:", req.body.dummy_pdf_path);

    let absolutePath = req.body.pdfPath || req.body.dummy_pdf_path;

    if (Array.isArray(absolutePath)) {
      absolutePath = absolutePath[0];
    }

    if (
      absolutePath &&
      absolutePath !== "undefined" &&
      absolutePath !== "null" &&
      typeof absolutePath === "string" &&
      absolutePath.trim() !== ""
    ) {
      pdfPath = absolutePath;
      pathSource = "FRONTEND_ABSOLUTE_PATH";
      console.log(
        `✅ [PRIORITY 1] Using absolute path from frontend: ${pdfPath}`,
      );

      // Check if this looks like a bundled dummy PDF path
      if (
        pdfPath.includes("dummy_placeholder.pdf") ||
        pdfPath.includes("dummy")
      ) {
        console.log(
          `   ℹ️ This appears to be a BUNDLED DUMMY PDF path from Electron`,
        );
      } else {
        console.log(
          `   ℹ️ This appears to be a REAL PDF path from user selection`,
        );
      }
    }
    // SECOND PRIORITY: If no absolute path but we have an uploaded PDF file
    else if (pdfFile) {
      pdfPath = path.resolve(pdfFile.path);
      pathSource = "UPLOADED_FILE_PATH";
      console.log(
        `✅ [PRIORITY 2] No absolute path provided, using uploaded file path: ${pdfPath}`,
      );
    }
    // THIRD PRIORITY: If skipPdfUpload is true, we should NOT use any PDF
    else if (skipPdfUpload) {
      pdfPath = null; // No PDF path when skipping upload
      pathSource = "SKIP_UPLOAD";
      console.log(`✅ [PRIORITY 3] PDF upload skipped, no path stored`);
    }
    // FOURTH PRIORITY: No PDF file and not skipping - fallback to backend dummy
    else {
      if (!fs.existsSync(dummyPdfPath)) {
        console.error(`❌ Backend dummy PDF not found at: ${dummyPdfPath}`);
        return res.status(500).json({
          success: false,
          message:
            'Dummy PDF not found on server at "uploads/static/dummy_placeholder.pdf".',
        });
      }
      pdfPath = dummyPdfPath;
      pathSource = "BACKEND_DUMMY_FALLBACK";
      console.log(`✅ [PRIORITY 4] Using backend dummy PDF path: ${pdfPath}`);
    }

    // Handle case where pdfPath might be an array (should not happen, but safe check)
    if (Array.isArray(pdfPath)) {
      console.warn(
        `⚠️ pdfPath is an array with ${pdfPath.length} items, taking first item`,
      );
      pdfPath = pdfPath[0];
      pathSource += "_ARRAY_FIXED";
    }

    console.log("-".repeat(50));
    console.log("📊 PDF PATH DECISION SUMMARY:");
    console.log("   - Source:", pathSource);
    console.log("   - Final PDF path:", pdfPath);
    console.log(
      "   - Will store in DB:",
      pdfPath !== null ? "YES" : "NO (null)",
    );
    console.log("-".repeat(50));

    // Parse formData JSON if provided
    let payload = req.body || {};
    if (payload.formData) {
      try {
        payload = JSON.parse(payload.formData);
        console.log("6️⃣ Parsed formData payload successfully");
      } catch (err) {
        console.error("❌ Failed to parse formData:", err.message);
        return res
          .status(400)
          .json({ success: false, message: "Invalid formData payload." });
      }
    }

    // Build assets from excel
    console.log("7️⃣ Extracting assets from Excel...");
    const assets = extractAssetsFromExcel(excelPath, {
      owner_name: payload.client_name || payload.owner_name || "",
      inspection_date: payload.inspection_date || "",
    });

    if (!assets.length) {
      console.error("❌ No assets found in Excel file");
      return res.status(400).json({
        success: false,
        message: "No assets found in provided excel file.",
      });
    }
    console.log(`   - Found ${assets.length} assets`);

    const valuers = sanitizeValuers(payload.valuers);
    console.log(`   - Valuers: ${valuers.length}`);

    const duplicateReport = new DuplicateReport({
      user_id: user.id || user._id,
      user_phone: user.phone,
      taqeem_user: user.taqeemUser || null,
      company: user.company || null,
      company_office_id: companyOfficeId,

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

      // ✅ Store the resolved PDF path
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

    console.log("8️⃣ Saving duplicate report to database...");
    console.log("   - PDF path being saved:", duplicateReport.pdf_path);
    console.log("   - skipPdfUpload:", skipPdfUpload);
    console.log("   - Has PDF file:", !!pdfFile);

    await duplicateReport.save();

    console.log("✅ Report saved successfully with ID:", duplicateReport._id);
    console.log("   - Stored PDF path in DB:", duplicateReport.pdf_path);

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
      console.log("   - Notification created");
    } catch (notifyError) {
      console.warn("   - Failed to create notification:", notifyError.message);
    }

    console.log("=".repeat(50));
    console.log("🎉 DUPLICATE REPORT CREATION COMPLETE");
    console.log("=".repeat(50));

    return res.status(201).json({
      success: true,
      message: "Duplicate report stored.",
      data: { id: duplicateReport._id, report_id: duplicateReport.report_id },
    });
  } catch (error) {
    console.error("💥 ERROR creating duplicate report:");
    console.error("   - Message:", error.message);
    console.error("   - Stack:", error.stack);
    return res.status(500).json({ success: false, message: error.message });
  }
};
