const xlsx = require("xlsx");
const path = require("path");
const fs = require("fs");
const dummyPdfPath = path.resolve("uploads/static/dummy_placeholder.pdf");

const SubmitReportsQuickly = require("../../infrastructure/models/SubmitReportsQuickly");
const User = require("../../infrastructure/models/user");
const {
  createNotification,
} = require("../../application/services/notification/notification.service");
const { extractCompanyOfficeId } = require("../utils/companyOffice");

// ------------ helpers ------------

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

function normalizeKey(str) {
  if (!str) return "";
  return str.toString().normalize("NFC").replace(/\s+/g, " ").trim();
}

const ASSET_USAGE_TEXT_TO_ID = {
  زراعي: 38,
  بحري: 39,
  المواصلات: 40,
  طيران: 41,
  "الخدمات اللوجستية": 42,
  طباعة: 43,
  بناء: 44,
  "الغزل والنسيج": 45,
  ضيافة: 46,
  التعدين: 47,
  "الدباغة والتغليف": 48,
  الاتصالات: 49,
  "النفط والغاز": 50,
  المستشفيات: 51,
  الأدوية: 52,
  "مأكولات ومشروبات": 53,
  مياه: 54,
  "مياه الصرف الصحي": 55,
  الكهرباء: 56,
};

const normalizeAssetUsageText = (value) =>
  String(value || "")
    .toLowerCase()
    .normalize("NFC")
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .replace(/[ـ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

const NORMALIZED_ASSET_USAGE_TEXT_TO_ID = Object.entries(
  ASSET_USAGE_TEXT_TO_ID,
).reduce((acc, [label, id]) => {
  acc[normalizeAssetUsageText(label)] = id;
  return acc;
}, {});

const VALID_ASSET_USAGE_IDS = new Set(Object.values(ASSET_USAGE_TEXT_TO_ID));

function resolveAssetUsageId(rawValue) {
  if (rawValue === null || rawValue === undefined) return null;
  if (typeof rawValue === "number" && Number.isInteger(rawValue))
    return rawValue;
  const rawText = String(rawValue || "").trim();
  if (!rawText) return null;
  const numeric = Number(rawText);
  if (Number.isInteger(numeric)) return numeric;
  const normalized = normalizeAssetUsageText(rawText);
  return NORMALIZED_ASSET_USAGE_TEXT_TO_ID[normalized] || null;
}

// Robust Excel date parser
function parseExcelDate(value) {
  if (value === null || value === undefined || value === "") return null;

  if (value instanceof Date && !isNaN(value)) return value;

  if (typeof value === "object") {
    if (value.v !== undefined) {
      return parseExcelDate(value.v);
    }
    if (value instanceof Date && !isNaN(value)) return value;
  }

  if (typeof value === "number") {
    const msPerDay = 24 * 60 * 60 * 1000;
    const excelEpoch1970 = 25569; // serial for 1970-01-01
    const days = value - excelEpoch1970;
    const dt = new Date(days * msPerDay);
    return isNaN(dt.getTime()) ? null : dt;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    const iso = /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/.exec(trimmed);
    if (iso) {
      const y = parseInt(iso[1], 10);
      const m = parseInt(iso[2], 10);
      const d = parseInt(iso[3], 10);
      const dt = new Date(y, m - 1, d);
      return isNaN(dt.getTime()) ? null : dt;
    }

    const dmy = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/.exec(trimmed);
    if (dmy) {
      const p1 = parseInt(dmy[1], 10);
      const p2 = parseInt(dmy[2], 10);
      const y = parseInt(dmy[3], 10);

      let day = p1;
      let month = p2;
      if (p1 > 12 && p2 <= 12) {
        day = p1;
        month = p2;
      } else if (p2 > 12 && p1 <= 12) {
        day = p2;
        month = p1;
      } else {
        day = p1;
        month = p2;
      }
      const dt = new Date(y, month - 1, day);
      return isNaN(dt.getTime()) ? null : dt;
    }

    const parsed = Date.parse(trimmed);
    return isNaN(parsed) ? null : new Date(parsed);
  }

  return null;
}

function formatDateYyyyMmDd(value) {
  if (value === null || value === undefined || value === "") return "";

  const dt = value instanceof Date ? value : parseExcelDate(value);
  if (!(dt instanceof Date) || isNaN(dt.getTime())) return "";

  // Use local date parts consistently (same as schema)
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getTodayDateString() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function toSafeBasename(value, fallback) {
  const normalized = normalizeKey(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback || `quick-${Date.now()}`;
}

// Extract valuers from excel row (look for valuerId, valuerName, and percentage columns)
function extractValuersFromRow(row) {
  const valuers = [];
  const keys = Object.keys(row);

  // Normalize key names (handle variations like "valuerName", "valuer_name", "valuer Name", etc.)
  const normalizeKey = (key) => {
    if (!key) return "";
    return String(key)
      .toLowerCase()
      .trim()
      .replace(/[\s_]+/g, "");
  };

  // Find all valuer-related columns
  const valuerColumns = {};
  keys.forEach((key) => {
    const normalized = normalizeKey(key);
    if (normalized.includes("valuerid") || normalized.includes("valuerid")) {
      valuerColumns.id = key;
    } else if (
      normalized.includes("valuername") ||
      normalized.includes("valuername")
    ) {
      valuerColumns.name = key;
    } else if (
      normalized.includes("percentage") ||
      normalized.includes("percent")
    ) {
      valuerColumns.percentage = key;
    }
  });

  // If we have structured columns (valuerId, valuerName, percentage), extract them
  if (valuerColumns.id || valuerColumns.name || valuerColumns.percentage) {
    // Try to extract multiple valuers (valuerId1, valuerName1, percentage1, etc.)
    for (let i = 1; i <= 10; i++) {
      const idKey =
        row[`valuerId${i}`] ||
        row[`valuer_id${i}`] ||
        row[`valuerId_${i}`] ||
        (i === 1 && (row.valuerId || row.valuer_id || row["valuerId"]));
      const nameKey =
        row[`valuerName${i}`] ||
        row[`valuer_name${i}`] ||
        row[`valuerName_${i}`] ||
        (i === 1 && (row.valuerName || row.valuer_name || row["valuerName"]));
      const pctKey =
        row[`percentage${i}`] ||
        row[`percent${i}`] ||
        row[`percentage_${i}`] ||
        (i === 1 && (row.percentage || row.percent || row["percentage"]));

      if (nameKey) {
        const name = String(nameKey).trim();
        const pct = pctKey ? Number(pctKey) : 0;
        if (name && !isNaN(pct) && pct > 0) {
          valuers.push({ valuerName: name, percentage: pct });
        }
      }
    }
  }

  // If no structured valuers found, try to find any valuer columns by pattern
  if (valuers.length === 0) {
    // Look for columns that might contain valuer data
    const valuerNameKeys = keys.filter((k) => {
      const normalized = normalizeKey(k);
      return (
        normalized.includes("valuername") ||
        normalized.includes("valuername") ||
        (normalized.includes("valuer") && normalized.includes("name"))
      );
    });

    const percentageKeys = keys.filter((k) => {
      const normalized = normalizeKey(k);
      return (
        normalized.includes("percentage") || normalized.includes("percent")
      );
    });

    // Try to match valuer names with percentages
    valuerNameKeys.forEach((nameKey, idx) => {
      const name = String(row[nameKey]).trim();
      if (name) {
        const pctKey = percentageKeys[idx] || percentageKeys[0];
        const pct = pctKey ? Number(row[pctKey]) : 0;
        if (name && !isNaN(pct) && pct > 0) {
          valuers.push({ valuerName: name, percentage: pct });
        }
      }
    });
  }

  return valuers;
}

// Aggregate valuers from all rows (merge by name, sum percentages)
function aggregateValuers(allValuers) {
  const valuerMap = new Map();

  allValuers.forEach((valuer) => {
    if (!valuer || !valuer.valuerName) return;
    const name = String(valuer.valuerName).trim();
    const pct = Number(valuer.percentage) || 0;

    if (name && pct > 0) {
      if (valuerMap.has(name)) {
        valuerMap.set(name, valuerMap.get(name) + pct);
      } else {
        valuerMap.set(name, pct);
      }
    }
  });

  // Convert to array and normalize percentages to sum to 100
  const valuers = Array.from(valuerMap.entries()).map(([name, totalPct]) => ({
    valuerName: name,
    percentage: totalPct,
  }));

  // Normalize to 100% if total is not 100
  const total = valuers.reduce((sum, v) => sum + v.percentage, 0);
  if (total > 0 && Math.abs(total - 100) > 0.01) {
    valuers.forEach((v) => {
      v.percentage = Math.round((v.percentage / total) * 100);
    });
  }

  return valuers;
}

// ------------ main controller ------------

exports.processSubmitReportsQuicklyBatch = async (req, res) => {
  try {
    // 0) Validate files
    if (!req.files || !req.files.excels || !req.files.excels.length) {
      return res.status(400).json({
        status: "failed",
        error: "At least one Excel file (field 'excels') is required.",
      });
    }

    const excelFiles = req.files.excels;
    const pdfFiles = req.files.pdfs || [];
    const skipPdfUpload =
      req.body.skipPdfUpload === "true" || req.body.skipPdfUpload === true;
    const user_id =
      req.user?.id || req.user?._id || req.user?.userId || req.user?.user_id;
    const companyOfficeId = extractCompanyOfficeId(req);

    if (!user_id) {
      return res.status(401).json({
        status: "failed",
        error: "Unauthorized",
      });
    }

    let authUser = null;
    try {
      authUser = await User.findById(user_id).select("phone company").lean();
    } catch (err) {
      authUser = null;
    }

    const taqeemUser = req.user?.taqeemUser || authUser?.taqeemUser || null;
    const resolvedPhone = authUser?.phone || req.user?.phone || null;
    const resolvedCompany = authUser?.company || req.user?.company || null;
    const isGuestToken = Boolean(req.user?.guest) && !resolvedPhone;

    console.log("=== PDF PATH DEBUGGING ===");
    console.log("1. skipPdfUpload:", skipPdfUpload);
    console.log(
      "2. Excel files:",
      excelFiles.map((f) => f.originalname),
    );
    console.log(
      "3. PDF files:",
      pdfFiles.map((f) => f.originalname),
    );
    console.log("4. req.body keys:", Object.keys(req.body));
    console.log();

    // 1) Build maps by basename (without extension)
    const excelMap = new Map(); // basename -> { file, pdfPath: '' }
    excelFiles.forEach((file) => {
      const baseName = normalizeKey(path.parse(file.originalname).name);
      if (!excelMap.has(baseName)) {
        excelMap.set(baseName, { file, pdfPath: "" });
      } else {
        throw badRequest(
          `Duplicate Excel base name detected: "${baseName}". Please ensure unique Excel file names.`,
        );
      }
    });

    console.log("📋 Excel map keys:", Array.from(excelMap.keys()));

    // 2) Match uploaded PDFs to Excels by basename and get absolute paths from request body
    const unmatchedPdfs = [];
    pdfFiles.forEach((file) => {
      const fileName = file.originalname;
      const fileNameWithoutExt = path.parse(fileName).name;
      const pdfBase = normalizeKey(fileNameWithoutExt);
      const bucket = excelMap.get(pdfBase);

      if (!bucket) {
        unmatchedPdfs.push(file.originalname);
      } else {
        // Get the absolute path from request body (sent from frontend)
        const absolutePath = req.body[pdfBase];

        if (
          absolutePath &&
          absolutePath !== "undefined" &&
          absolutePath !== "null"
        ) {
          bucket.pdfPath = absolutePath;
          console.log(`✅ Matched PDF for ${pdfBase}: ${absolutePath}`);
        } else {
          // If no absolute path is provided from frontend, this is an error for real PDFs
          if (!skipPdfUpload) {
            console.warn(
              `⚠️ No absolute path provided for PDF: ${file.originalname}`,
            );
          }
        }
      }
    });

    if (unmatchedPdfs.length > 0 && !skipPdfUpload) {
      return res.status(400).json({
        status: "failed",
        error:
          "These PDFs do not match any Excel file by name: " +
          unmatchedPdfs.join(", "),
      });
    }

    // 3) CRITICAL: For ALL Excel files (whether skipPdfUpload or not), check req.body for paths
    // 3) CRITICAL: For ALL Excel files, check req.body for paths
    console.log("\n📋 Checking req.body for PDF paths for all Excel files...");

    // Build a map of normalized req.body keys for lookup
    const bodyKeysMap = new Map();
    Object.keys(req.body).forEach((key) => {
      const normalizedBodyKey = key
        .toString()
        .normalize("NFC")
        .trim()
        .toLowerCase()
        .replace(/[\W_]+/g, ""); // Match frontend normalization
      bodyKeysMap.set(normalizedBodyKey, req.body[key]);
    });

    for (const [baseName, bucket] of excelMap.entries()) {
      if (!bucket.pdfPath) {
        // Normalize the baseName the same way frontend does
        const normalizedBaseName = baseName
          .toString()
          .normalize("NFC")
          .trim()
          .toLowerCase()
          .replace(/[\W_]+/g, "");

        const pathFromBody = bodyKeysMap.get(normalizedBaseName);

        console.log(
          `  Checking ${baseName} (normalized: ${normalizedBaseName}):`,
          {
            found: !!pathFromBody,
            value: pathFromBody,
          },
        );

        if (
          pathFromBody &&
          pathFromBody !== "undefined" &&
          pathFromBody !== "null"
        ) {
          bucket.pdfPath = pathFromBody;
          console.log(`  ✅ Set PDF path for ${baseName}: ${pathFromBody}`);
        }
      }
    }

    // 4) Final fallback: Use default dummy path for any Excel still without a path
    const defaultDummyPath = dummyPdfPath; // Use the resolved path at top of file
    excelMap.forEach((bucket, baseName) => {
      if (!bucket.pdfPath) {
        bucket.pdfPath = defaultDummyPath;
        console.log(
          `  ⚠️ Using fallback dummy path for ${baseName}: ${defaultDummyPath}`,
        );
      }
    });

    // Debug: Show final state
    console.log("\n📊 Final PDF paths:");
    excelMap.forEach((bucket, baseName) => {
      console.log(`  ${baseName} -> ${bucket.pdfPath}`);
    });
    console.log("===========================\n");

    // 2) Generate batchId for this request
    const batchId = `QR-${Date.now()}`;
    const todayDate = getTodayDateString();

    const docsToInsert = [];

    // 3) Process each Excel file
    for (const [baseName, { file, pdfPath }] of excelMap.entries()) {
      const excelPath = file.path;
      let workbook;
      try {
        workbook = xlsx.readFile(excelPath);
      } catch (readErr) {
        throw badRequest(
          `Excel "${file.originalname}" could not be read. Please confirm it is a valid .xlsx/.xls file.`,
        );
      }

      const marketSheet = workbook.Sheets["market"];
      const costSheet = workbook.Sheets["cost"];

      if (!marketSheet && !costSheet) {
        return res.status(400).json({
          status: "failed",
          error: `Excel "${file.originalname}" must contain at least one of 'market' or 'cost' sheets.`,
        });
      }

      const marketRows = marketSheet
        ? xlsx.utils.sheet_to_json(marketSheet, { defval: "" })
        : [];
      const costRows = costSheet
        ? xlsx.utils.sheet_to_json(costSheet, { defval: "" })
        : [];

      // 3.1 Build assets from market + cost sheets
      const assets = [];
      let assets_total_value = 0;
      const allValuers = [];

      // --- market assets ---
      marketRows.forEach((row, index) => {
        const assetName =
          row.asset_name || row["asset_name\n"] || row["Asset Name"];
        if (!assetName) return;

        const assetUsageRaw =
          row.asset_usage_id ||
          row["asset_usage_id\n"] ||
          row["Asset Usage ID"] ||
          "";
        const asset_usage_id = resolveAssetUsageId(assetUsageRaw);
        if (
          !asset_usage_id ||
          asset_usage_id <= 0 ||
          !VALID_ASSET_USAGE_IDS.has(asset_usage_id)
        ) {
          throw badRequest(
            `Asset "${assetName}" missing or invalid asset_usage_id "${assetUsageRaw}" in market sheet.`,
          );
        }

        const final_value = Number(
          row.final_value || row["final_value\n"] || row["Final Value"] || 0,
        );
        if (!Number.isInteger(final_value) || final_value <= 0) {
          throw badRequest(
            `Asset "${assetName}" has invalid final_value in market sheet. Must be a positive integer.`,
          );
        }

        assets_total_value += final_value;

        const inspection_date =
          formatDateYyyyMmDd(
            parseExcelDate(
              row.inspection_date ||
                row["inspection_date\n"] ||
                row["Inspection Date"],
            ),
          ) || todayDate;

        const region = String(row.region || row["Region"] || "").trim();
        const city = String(row.city || row["City"] || "").trim();

        const rowValuers = extractValuersFromRow(row);
        allValuers.push(...rowValuers);

        assets.push({
          asset_id: row.id || row.asset_id || index + 1,
          asset_name: String(assetName).trim(),
          asset_usage_id: asset_usage_id,
          region: region || "",
          city: city || "",
          owner_name: "0",
          inspection_date: inspection_date,
          source_sheet: "market",
          final_value: final_value,
          market_approach: "1",
          market_approach_value: final_value.toString(),
          cost_approach: "0",
          cost_approach_value: "0",
          production_capacity: "0",
          production_capacity_measuring_unit: "0",
          product_type: "0",
        });
      });

      // --- cost assets ---
      costRows.forEach((row, index) => {
        const assetName =
          row.asset_name || row["asset_name\n"] || row["Asset Name"];
        if (!assetName) return;

        const assetUsageRaw =
          row.asset_usage_id ||
          row["asset_usage_id\n"] ||
          row["Asset Usage ID"] ||
          "";
        const asset_usage_id = resolveAssetUsageId(assetUsageRaw);
        if (
          !asset_usage_id ||
          asset_usage_id <= 0 ||
          !VALID_ASSET_USAGE_IDS.has(asset_usage_id)
        ) {
          throw badRequest(
            `Asset "${assetName}" missing or invalid asset_usage_id "${assetUsageRaw}" in cost sheet.`,
          );
        }

        const final_value_raw =
          row.final_value ||
          row["final_value\n"] ||
          row["Final Value"] ||
          row["value"] ||
          row["Value"] ||
          "";

        if (final_value_raw === "" || final_value_raw === null) {
          throw badRequest(
            `Asset "${assetName}" has no final_value in cost sheet. It must be an integer.`,
          );
        }

        const final_value_num = Number(final_value_raw);

        if (
          isNaN(final_value_num) ||
          !Number.isInteger(final_value_num) ||
          final_value_num <= 0
        ) {
          throw badRequest(
            `Asset "${assetName}" has invalid final_value "${final_value_raw}". Must be a positive integer.`,
          );
        }

        const final_value = final_value_num;
        assets_total_value += final_value;

        const inspection_date =
          formatDateYyyyMmDd(
            parseExcelDate(
              row.inspection_date ||
                row["inspection_date\n"] ||
                row["Inspection Date"],
            ),
          ) || todayDate;

        const region = String(row.region || row["Region"] || "").trim();
        const city = String(row.city || row["City"] || "").trim();

        const rowValuers = extractValuersFromRow(row);
        allValuers.push(...rowValuers);

        assets.push({
          asset_id: row.id || row.asset_id || index + 1,
          asset_name: String(assetName).trim(),
          asset_usage_id: asset_usage_id,
          region: region || "",
          city: city || "",
          owner_name: "0",
          inspection_date: inspection_date,
          source_sheet: "cost",
          final_value: final_value,
          market_approach: "0",
          market_approach_value: "0",
          cost_approach: "1",
          cost_approach_value: final_value.toString(),
          production_capacity: "0",
          production_capacity_measuring_unit: "0",
          product_type: "0",
        });
      });

      if (!assets.length) {
        return res.status(400).json({
          status: "failed",
          error: `Excel "${file.originalname}" has no assets in 'market' or 'cost' sheets.`,
        });
      }

      const valuers = aggregateValuers(allValuers);
      const number_of_macros = assets.length;
      const title = `عدد الأصول (${number_of_macros}) + القيمة النهائية (${assets_total_value})`;
      const client_name = `عدد الأصول (${number_of_macros}) + القيمة النهائية (${assets_total_value})`;

      const firstAsset = assets[0];
      const region = firstAsset.region || "";
      const city = firstAsset.city || "";

      // 3.6 Build document for this Excel
      docsToInsert.push({
        user_id,
        user_phone: isGuestToken ? null : resolvedPhone,
        taqeem_user: taqeemUser || null,
        company: resolvedCompany || null,
        company_office_id: companyOfficeId,
        batch_id: batchId,
        source_excel_name: file.originalname,
        title: title,
        client_name: client_name,
        purpose_id: 1,
        value_premise_id: 1,
        report_type: "تقرير مفصل",
        valued_at: todayDate,
        submitted_at: todayDate,
        inspection_date: firstAsset.inspection_date || todayDate,
        assumptions: 0,
        special_assumptions: 0,
        number_of_macros: number_of_macros,
        telephone: "999999999",
        email: "a@a.com",
        region: region,
        city: city,
        valuers: valuers,
        final_value: assets_total_value,
        asset_data: assets,
        pdf_path: pdfPath, // This will now be the absolute path from client
        report_status: "new",
        submit_state: 0,
      });
    }

    // 4) Insert all docs
    const created = await SubmitReportsQuickly.insertMany(docsToInsert);

    console.log("====================================");
    console.log("📦 SUBMIT REPORTS QUICKLY BATCH IMPORT SUCCESS");
    console.log("BatchId:", batchId);
    console.log("Inserted reports:", created.length);
    console.log(
      "PDF paths stored:",
      created.map((r) => r.pdf_path),
    );
    console.log("====================================");

    return res.json({
      status: "success",
      batchId,
      created: created.length,
      reports: created,
    });
  } catch (err) {
    console.error("Submit reports quickly batch upload error:", err);
    const statusCode =
      err?.statusCode && Number.isInteger(err.statusCode)
        ? err.statusCode
        : 500;
    return res.status(statusCode).json({
      status: "failed",
      error: err?.message || "Unexpected error",
    });
  }
};

exports.listSubmitReportsQuickly = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const limit = Math.min(Number(req.query.limit) || 200, 500);
    const companyOfficeId = extractCompanyOfficeId(req);
    const unassignedOnly = ["1", "true", "yes"].includes(
      String(req.query.unassigned || "")
        .trim()
        .toLowerCase(),
    );
    const unassignedFilter = {
      $or: [
        { company_office_id: { $exists: false } },
        { company_office_id: null },
        { company_office_id: "" },
      ],
    };
    const ownerQuery = req.user?.taqeemUser
      ? {
          $or: [{ user_id: req.user.id }, { taqeem_user: req.user.taqeemUser }],
        }
      : { user_id: req.user.id };

    const scopedQuery = unassignedOnly
      ? unassignedFilter
      : companyOfficeId
        ? { company_office_id: companyOfficeId }
        : {};
    const query = { $and: [ownerQuery, scopedQuery] };
    const reports = await SubmitReportsQuickly.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit);

    return res.json({ success: true, reports });
  } catch (error) {
    console.error("Error listing submit reports quickly:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getQuickReportsByUserId = async (req, res) => {
  try {
    console.log("user", req.user);
    const user_id =
      req.user?.id || req.user?._id || req.user?.userId || req.user?.user_id;

    if (!user_id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const limit = Math.min(Number(req.query.limit) || 10, 100); // Default 10, max 100
    const page = Math.max(Number(req.query.page) || 1, 1);
    const skip = (page - 1) * limit;
    const companyOfficeId = extractCompanyOfficeId(req);
    const unassignedOnly = ["1", "true", "yes"].includes(
      String(req.query.unassigned || "")
        .trim()
        .toLowerCase(),
    );
    const baseQuery = req.user?.taqeemUser
      ? { $or: [{ user_id }, { taqeem_user: req.user.taqeemUser }] }
      : { user_id };
    let query = baseQuery;
    if (unassignedOnly) {
      query = {
        $and: [
          baseQuery,
          {
            $or: [
              { company_office_id: { $exists: false } },
              { company_office_id: null },
              { company_office_id: "" },
            ],
          },
        ],
      };
    } else if (companyOfficeId) {
      query = { ...baseQuery, company_office_id: companyOfficeId };
    }

    const [reports, total] = await Promise.all([
      SubmitReportsQuickly.find(query)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(), // Add .lean() for better performance
      SubmitReportsQuickly.countDocuments(query),
    ]);

    return res.json({
      success: true,
      reports,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page < Math.ceil(total / limit),
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    console.error("Error fetching quick reports by userId:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.updateSubmitReportsQuickly = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const reportId = req.params.id;
    const report = await SubmitReportsQuickly.findById(reportId);
    if (!report) {
      return res
        .status(404)
        .json({ success: false, message: "Report not found." });
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
      "number_of_macros",
      "telephone",
      "email",
      "region",
      "city",
      "valuers",
      "final_value",
      "client_name",
      "checked",
      "report_status",
      "company_office_id",
    ];

    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    Object.assign(report, updates);
    await report.save();

    return res.json({ success: true, report });
  } catch (error) {
    console.error("Error updating submit reports quickly:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteSubmitReportsQuickly = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const reportId = req.params.id;
    const report = await SubmitReportsQuickly.findById(reportId);
    if (!report) {
      return res
        .status(404)
        .json({ success: false, message: "Report not found." });
    }

    await report.deleteOne();

    try {
      await createNotification({
        userId: req.user?.id || req.user?._id,
        type: "report",
        level: "danger",
        title: "Report deleted",
        message: `Report ${reportId} was deleted.`,
        data: {
          reportId,
          view: "submit-reports-quickly",
          action: "deleted",
        },
      });
    } catch (notifyError) {
      console.warn("Failed to create delete notification", notifyError);
    }

    return res.json({ success: true });
  } catch (error) {
    console.error("Error deleting submit reports quickly:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateSubmitReportsQuicklyAsset = async (req, res) => {
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

    const report = await SubmitReportsQuickly.findById(reportId);
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
      "inspection_date",
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
    console.error("Error updating submit reports quickly asset:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteSubmitReportsQuicklyAsset = async (req, res) => {
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

    const report = await SubmitReportsQuickly.findById(reportId);
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
    console.error("Error deleting submit reports quickly asset:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
