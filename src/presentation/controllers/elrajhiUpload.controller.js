// src/presentation/controllers/elrajhiBatch.controller.js
const xlsx = require("xlsx");
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");

const UrgentReport = require("../../infrastructure/models/UrgentReport");
const { extractCompanyOfficeId } = require("../utils/companyOffice");

// ---------- helpers ----------

function normalizeKey(str) {
  if (!str) return "";
  return str.toString().normalize("NFC").replace(/\s+/g, " ").trim();
}

const safeString = (value) =>
  value === undefined || value === null ? "" : String(value);

const toNumber = (value) => {
  if (value === undefined || value === null || value === "") return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
};

const normalizeDateForUpdate = (value) => {
  if (value === undefined) return undefined;
  const raw = safeString(value).trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const parsed = new Date(raw);
  if (isNaN(parsed.getTime())) return raw;
  return parsed.toISOString().slice(0, 10);
};

const cleanValuersPayload = (rawValuers) => {
  if (!rawValuers) return undefined;

  let valuers = rawValuers;
  if (typeof rawValuers === "string") {
    try {
      valuers = JSON.parse(rawValuers);
    } catch (err) {
      console.warn("Failed to parse valuers payload", err);
      return undefined;
    }
  }

  if (!Array.isArray(valuers)) return undefined;

  const cleaned = valuers
    .map((valuer) => {
      const id = safeString(
        valuer?.valuerId || valuer?.valuer_id || valuer?.id,
      ).trim();
      const name = safeString(
        valuer?.valuerName || valuer?.valuer_name || valuer?.name,
      ).trim();
      const pct = toNumber(
        valuer?.percentage ??
          valuer?.contribution_percentage ??
          valuer?.pct ??
          valuer?.percent,
      );

      return {
        valuerId: id,
        valuerName: name,
        percentage: pct ?? 0,
      };
    })
    .filter((v) => v.valuerId || v.valuerName || Number.isFinite(v.percentage));

  return cleaned.length ? cleaned : [];
};

function getPlaceholderPdfPath() {
  const preferredPath = path.resolve(
    __dirname,
    "../../../uploads/static/dummy_placeholder.pdf",
  );

  if (fs.existsSync(preferredPath)) {
    return preferredPath;
  }

  const fallbackPath = path.resolve(
    "uploads",
    "static",
    "dummy_placeholder.pdf",
  );

  if (!fs.existsSync(fallbackPath)) {
    throw new Error(
      "Placeholder PDF missing at uploads/static/dummy_placeholder.pdf",
    );
  }

  return fallbackPath;
}

const buildOwnerQuery = (userContext = {}) => {
  const userId = userContext.id || userContext._id || null;
  const taqeemUser = userContext.taqeemUser || null;
  const clauses = [];

  if (userId) clauses.push({ user_id: userId });
  if (taqeemUser) clauses.push({ taqeem_user: taqeemUser });

  if (!clauses.length) return {};
  return clauses.length === 1 ? clauses[0] : { $or: clauses };
};

// 🔹 Same mojibake fix you used in processUpload
function fixMojibake(str) {
  if (!str) return "";
  // reinterpret string bytes as latin1, then decode as utf8
  return Buffer.from(str, "latin1").toString("utf8");
}

// function parseExcelDate(value) {
//   if (!value) return null;

//   if (value instanceof Date) return value;

//   if (typeof value === "number") {
//     const excelEpoch = new Date(Date.UTC(1899, 11, 30)); // 1899-12-30
//     const msPerDay = 24 * 60 * 60 * 1000;
//     return new Date(excelEpoch.getTime() + value * msPerDay);
//   }

//   if (typeof value === "string") {
//     const trimmed = value.trim();
//     if (!trimmed) return null;

//     if (/^\d+$/.test(trimmed)) {
//       const serial = parseInt(trimmed, 10);
//       const excelEpoch = new Date(Date.UTC(1899, 11, 30));
//       const msPerDay = 24 * 60 * 60 * 1000;
//       return new Date(excelEpoch.getTime() + serial * msPerDay);
//     }

//     const parts = trimmed.split(/[\/\-]/).map((p) => p.trim());
//     if (parts.length !== 3) return null;

//     const [d, m, y] = parts.map((p) => parseInt(p, 10));
//     if (!d || !m || !y) return null;

//     return new Date(y, m - 1, d);
//   }

//   return null;
// }

function toYMDFromDate(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10); // yyyy-mm-dd
}

function parseExcelDate(value) {
  if (!value) return null;

  // Already a JS Date
  if (value instanceof Date) {
    return toYMDFromDate(value);
  }

  // Excel serial number
  if (typeof value === "number") {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30)); // 1899-12-30
    const msPerDay = 24 * 60 * 60 * 1000;
    const d = new Date(excelEpoch.getTime() + value * msPerDay);
    return toYMDFromDate(d);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    // numeric serial in string
    if (/^\d+$/.test(trimmed)) {
      const serial = parseInt(trimmed, 10);
      const excelEpoch = new Date(Date.UTC(1899, 11, 30));
      const msPerDay = 24 * 60 * 60 * 1000;
      const d = new Date(excelEpoch.getTime() + serial * msPerDay);
      return toYMDFromDate(d);
    }

    // allow: dd/mm/yyyy or dd-mm-yyyy (your current behavior)
    const parts = trimmed.split(/[\/\-]/).map((p) => p.trim());
    if (parts.length !== 3) return null;

    const [dStr, mStr, yStr] = parts;
    const dNum = parseInt(dStr, 10);
    const mNum = parseInt(mStr, 10);
    const yNum = parseInt(yStr, 10);
    if (!dNum || !mNum || !yNum) return null;

    // build as UTC to avoid timezone shifting
    const dt = new Date(Date.UTC(yNum, mNum - 1, dNum));
    return toYMDFromDate(dt);
  }

  return null;
}

function ensureTempPdf(batch_id, assetId) {
  const tempDir = path.join("uploads", "temp");
  fs.mkdirSync(tempDir, { recursive: true });

  const tempFileName = `temp-${batch_id}-${assetId}.pdf`;
  const tempPath = path.join(tempDir, tempFileName);

  if (!fs.existsSync(tempPath)) {
    fs.writeFileSync(tempPath, ""); // empty placeholder
  }

  return path.resolve(tempPath);
}

function convertArabicDigits(str) {
  if (typeof str !== "string") return str;
  const map = {
    "٠": "0",
    "١": "1",
    "٢": "2",
    "٣": "3",
    "٤": "4",
    "٥": "5",
    "٦": "6",
    "٧": "7",
    "٨": "8",
    "٩": "9",
  };
  return str.replace(/[٠-٩]/g, (d) => map[d] ?? d);
}

/**
 * Detect valuer column sets from headers.
 * We require base headers:
 *   valuerId, valuerName, percentage
 * Excel will rename duplicates as valuerId_1, valuerId_2, etc.
 */
function detectValuerColumnsOrThrow(exampleRow) {
  const keys = Object.keys(exampleRow || {});
  const idKeys = [];
  const nameKeys = [];
  const pctKeys = [];

  for (const k of keys) {
    const base = k.split("_")[0]; // e.g. "valuerId" from "valuerId_1"
    const lowerBase = base.toLowerCase();

    if (lowerBase === "valuerid") {
      idKeys.push(k);
    } else if (lowerBase === "valuername") {
      nameKeys.push(k);
    } else if (lowerBase === "percentage") {
      pctKeys.push(k);
    }
  }

  idKeys.sort();
  nameKeys.sort();
  pctKeys.sort();

  const hasBaseName = nameKeys.length > 0;
  const hasBasePct = pctKeys.length > 0;

  const hasAnyValuerCols =
    idKeys.length > 0 || nameKeys.length > 0 || pctKeys.length > 0;

  if (!hasAnyValuerCols) {
    return {
      idKeys: [],
      nameKeys: [],
      pctKeys: [],
      allKeys: [],
      hasValuerColumns: false,
    };
  }

  if (!hasBaseName || !hasBasePct) {
    throw new Error(
      "Market sheet must contain headers 'valuerName' and 'percentage'. " +
        "If there are multiple valuers, Excel will create valuerName_1, percentage_1, etc.",
    );
  }

  const allKeys = Array.from(new Set([...idKeys, ...nameKeys, ...pctKeys]));

  return { idKeys, nameKeys, pctKeys, allKeys, hasValuerColumns: true };
}

/**
 * Build valuers[] for a given asset row using detected column keys.
 * Example:
 *   idKeys    = ["valuerId", "valuerId_1", "valuerId_2"]
 *   nameKeys  = ["valuerName", "valuerName_1", "valuerName_2"]
 *   pctKeys   = ["percentage", "percentage_1", "percentage_2"]
 */
function buildValuersForAsset(assetRow, valuerCols) {
  const { idKeys, nameKeys, pctKeys } = valuerCols;
  const maxLen = Math.max(idKeys.length, nameKeys.length, pctKeys.length);
  const valuers = [];

  for (let i = 0; i < maxLen; i++) {
    const idKey = idKeys[i];
    const nameKey = nameKeys[i];
    const pctKey = pctKeys[i];

    const id =
      idKey && Object.prototype.hasOwnProperty.call(assetRow, idKey)
        ? assetRow[idKey]
        : null;

    const name =
      nameKey && Object.prototype.hasOwnProperty.call(assetRow, nameKey)
        ? assetRow[nameKey]
        : null;

    const pctRaw =
      pctKey && Object.prototype.hasOwnProperty.call(assetRow, pctKey)
        ? assetRow[pctKey]
        : null;

    const allEmpty =
      (id === null || id === "" || id === undefined) &&
      (name === null || name === "" || name === undefined) &&
      (pctRaw === null || pctRaw === "" || pctRaw === undefined);

    // skip completely empty valuers
    if (allEmpty) continue;

    const pctString = convertArabicDigits(String(pctRaw ?? "")).trim();
    if (!pctString) {
      // Skip valuers that don't provide a percentage
      continue;
    }

    const pctNum = Number(
      pctString.replace(/[%٪]/g, "").replace(/,/g, ".").trim(),
    );

    if (Number.isNaN(pctNum)) {
      // Skip non-numeric percentages
      continue;
    }

    const percentage = pctNum >= 0 && pctNum <= 1 ? pctNum * 100 : pctNum;

    valuers.push({
      valuerId: id != null && id !== "" ? String(id) : "", // you can enforce non-empty later if you want
      valuerName: name || "",
      percentage,
    });
  }

  return valuers;
}

// ---------- main controller ----------

exports.processElrajhiExcel = async (req, res) => {
  try {
    // 0) Validate files
    if (!req.files || !req.files.excel || !req.files.excel[0]) {
      return res.status(400).json({
        status: "failed",
        error: "Excel file (field 'excel') is required",
      });
    }

    const userContext = req.user || {};
    const userPhone =
      userContext.phone ||
      userContext.phoneNumber ||
      userContext.mobile ||
      userContext.username ||
      "";
    const userId = userContext.id || userContext._id || null;
    const taqeemUser = userContext.taqeemUser || null;
    const companyOfficeId = extractCompanyOfficeId(req);

    // if (!userPhone) {
    //   return res.status(400).json({
    //     status: "failed",
    //     error: "User phone is required to submit reports.",
    //   });
    // }

    const excelFile = req.files.excel[0].path;
    const sourceExcelName = req.files.excel[0].originalname || "elrajhi.xlsx";
    const pdfFiles = req.files.pdfs || [];

    // 1) Read Excel
    const workbook = xlsx.readFile(excelFile);
    const reportSheet = workbook.Sheets["Report Info"];
    const marketSheet = workbook.Sheets["market"];

    if (!reportSheet || !marketSheet) {
      return res.status(400).json({
        status: "failed",
        error: "Excel must contain sheets named 'Report Info' and 'market'",
      });
    }

    const reportInfoRows = xlsx.utils.sheet_to_json(reportSheet, {
      defval: "",
    });
    const marketRows = xlsx.utils.sheet_to_json(marketSheet, { defval: "" });

    if (!reportInfoRows.length) {
      return res.status(400).json({
        status: "failed",
        error: "Sheet 'Report Info' is empty",
      });
    }

    if (!marketRows.length) {
      return res.status(400).json({
        status: "failed",
        error: "Sheet 'market' has no asset rows",
      });
    }

    const report = reportInfoRows[0];

    // 2) Parse dates from report info
    const valued_at = parseExcelDate(
      report.valued_at ||
        report["valued_at\n"] ||
        report["Valued At"] ||
        report["valued at"],
    );
    const submitted_at = parseExcelDate(
      report.submitted_at ||
        report["submitted_at\n"] ||
        report["Submitted At"] ||
        report["submitted at"],
    );
    const inspection_date = parseExcelDate(
      report.inspection_date ||
        report["inspection_date\n"] ||
        report["Inspection Date"] ||
        report["inspection date"],
    );

    // 3) Detect valuer columns – THROW if headers DON'T match
    let valuerCols;
    try {
      valuerCols = detectValuerColumnsOrThrow(marketRows[0]);
    } catch (e) {
      return res.status(400).json({
        status: "failed",
        error: e.message,
      });
    }

    const selectedValuers = cleanValuersPayload(req.body?.valuers);
    const hasSelectedValuers =
      Array.isArray(selectedValuers) && selectedValuers.length > 0;

    if (hasSelectedValuers) {
      const totalPct = selectedValuers.reduce(
        (sum, v) => sum + (Number(v.percentage) || 0),
        0,
      );
      const roundedTotal = Math.round(totalPct * 100) / 100;
      if (Math.abs(roundedTotal - 100) > 0.001) {
        return res.status(400).json({
          status: "failed",
          error: `Selected valuers must total 100%. Currently ${roundedTotal}%.`,
        });
      }
    } else if (!valuerCols.hasValuerColumns) {
      return res.status(400).json({
        status: "failed",
        error:
          "Valuers are required. Select valuers from Taqeem before sending.",
      });
    }

    // 4) Build pdfMap from uploaded PDFs (with mojibake fix)
    const pdfMap = {};
    pdfFiles.forEach((file) => {
      const rawName = file.originalname;
      const fixedName = fixMojibake(rawName);

      console.log("PDF rawName:", rawName);
      console.log("PDF fixedName:", fixedName);

      const baseName = path.parse(fixedName).name;
      const normalizedKey = normalizeKey(baseName);

      // Look up the absolute path using normalizedKey
      const absolutePath = req.body[normalizedKey];

      const fullPath =
        absolutePath && absolutePath !== "undefined" && absolutePath !== "null"
          ? absolutePath
          : path.resolve(file.path);

      // Store with normalizedKey as the key
      pdfMap[normalizedKey] = fullPath;

      console.log(`PDF mapping: ${normalizedKey} -> ${fullPath}`);
    });

    console.log("PDF files received:", pdfFiles.length);
    console.log("PDF map keys (normalized):", Object.keys(pdfMap));

    // 5) Generate batch_id for this upload
    const batch_id = `ELR-${Date.now()}`;

    // 6) Build docs: one per asset
    const docs = [];

    for (let index = 0; index < marketRows.length; index++) {
      const assetRow = marketRows[index];
      const rawAssetName = assetRow.asset_name;
      if (!rawAssetName) continue; // skip row if no asset_name

      // Normalize asset_name once (like trimmedCode in your other controller)
      const assetName = normalizeKey(rawAssetName);
      const asset_id = assetRow.id || index + 1;

      // value from market.final_value
      const value = Number(assetRow.final_value) || 0;

      // client_name = report.client_name + (id) + asset_name
      const baseClientName =
        report.client_name ||
        report["client_name\n"] ||
        report["Client Name"] ||
        "";
      const client_name = `${baseClientName} (${asset_id}) ${assetName}`;

      const region = assetRow.region || report.region || "";
      const city = assetRow.city || report.city || "";

      const asset_usage =
        assetRow["asset_usage_id\n"] ||
        assetRow.asset_usage_id ||
        assetRow.asset_usage ||
        "";

      const hasValuerData =
        valuerCols.hasValuerColumns &&
        valuerCols.allKeys.some((key) => {
          const value = assetRow[key];
          return (
            value !== null && value !== undefined && String(value).trim() !== ""
          );
        });

      // Build valuers[] for this asset from selected valuers or Excel (if provided).
      const valuers = hasSelectedValuers
        ? selectedValuers.map((v) => ({ ...v }))
        : hasValuerData
          ? buildValuersForAsset(assetRow, valuerCols)
          : [];

      if (!hasSelectedValuers && hasValuerData) {
        const totalPct = valuers.reduce(
          (sum, v) => sum + (Number(v.percentage) || 0),
          0,
        );

        const roundedTotal = Math.round(totalPct * 100) / 100;

        // allow tiny floating error, but must be 100
        if (Math.abs(roundedTotal - 100) > 0.001) {
          return res.status(400).json({
            status: "failed",
            error: `Asset "${assetName}" (row ${index + 1}) has total valuers percentage = ${roundedTotal}%. It must be exactly 100%.`,
          });
        }
      }

      // ---- PDF resolution ----
      let pdf_path = pdfMap[assetName] || null; // assetName is already normalized

      if (!pdf_path) {
        console.warn(
          "No PDF found for asset:",
          assetName,
          "using dummy-placeholder.pdf",
        );
        pdf_path = getPlaceholderPdfPath();
      } else {
        console.log(`PDF found for asset ${assetName}: ${pdf_path}`);
      }

      docs.push({
        batch_id,
        source_excel_name: sourceExcelName,
        number_of_macros: 1,
        user_id: userId,
        user_phone: userPhone,
        taqeem_user: taqeemUser,
        company: userContext.company || null,
        company_office_id: companyOfficeId,

        // Report-level (from Report Info)
        title: report.title,
        client_name,
        purpose_id: report.purpose_id,
        value_premise_id: report.value_premise_id,
        report_type: report.report_type,

        valued_at,
        submitted_at,
        inspection_date,

        assumptions: report.assumptions,
        special_assumptions: report.special_assumptions,
        owner_name: report.owner_name,
        telephone: report.telephone,
        email: report.email,

        region,
        city,

        // Per-asset overrides
        final_value: value,
        asset_id,
        asset_name: assetName, // store normalized name
        asset_usage,

        // Keep full market row
        asset: assetRow,

        // Structured valuers[]
        valuers,

        pdf_path,
        submit_state: 0,
        report_status: "INCOMPLETE",
      });
    }

    if (!docs.length) {
      return res.status(400).json({
        status: "failed",
        error: "No valid asset rows found to create reports.",
      });
    }

    // 7) Insert into DB
    const created = await UrgentReport.insertMany(docs);
    // Ensure all inserted docs carry the user phone (in case of missing values)
    await UrgentReport.updateMany(
      { batch_id },
      {
        $set: {
          user_phone: userPhone,
          user_id: userId,
          taqeem_user: taqeemUser,
        },
      },
    );

    console.log("====================================");
    console.log("📦 ELRAJHI BATCH IMPORT SUCCESS");
    console.log("batch_id:", batch_id);
    console.log("Inserted reports:", created.length);
    console.log("====================================");

    // 8) Response: send the batch of reports
    return res.json({
      status: "success",
      batchId: batch_id,
      created: created.length,
      excelName: sourceExcelName,
      downloadPath: `/api/elrajhi-upload/export/${batch_id}`,
      reports: created,
    });
  } catch (err) {
    console.error("Elrajhi batch upload error:", err);
    return res.status(500).json({
      status: "failed",
      error: err.message,
    });
  }
};

// Export a simple Excel with asset, client, and report IDs (no PDF path)
exports.exportElrajhiBatch = async (req, res) => {
  try {
    const { batchId } = req.params;
    if (!batchId) {
      return res.status(400).json({
        status: "failed",
        error: "batchId is required",
      });
    }

    const companyOfficeId = extractCompanyOfficeId(req);
    const baseQuery = { batch_id: batchId };
    const ownerQuery = buildOwnerQuery(req.user || {});
    const query = Object.keys(ownerQuery).length
      ? { $and: [baseQuery, ownerQuery] }
      : baseQuery;
    if (companyOfficeId) {
      query.company_office_id = companyOfficeId;
    }

    const reports = await UrgentReport.find(query)
      .sort({ asset_id: 1, createdAt: 1 })
      .lean();

    if (!reports.length) {
      return res.status(404).json({
        status: "failed",
        error: "No reports found for this batch.",
      });
    }

    const baseName = reports[0].source_excel_name || `${batchId}.xlsx`;
    const parsed = path.parse(baseName);
    const fileName = `${parsed.name} updated${parsed.ext || ".xlsx"}`;

    const header = ["#", "Asset Name", "Client Name", "Report ID"];
    const rows = reports.map((r, idx) => [
      idx + 1,
      r.asset_name || "",
      r.client_name || "",
      r.report_id || "",
    ]);

    const ws = xlsx.utils.aoa_to_sheet([header, ...rows]);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "Reports");

    const buffer = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });

    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );

    return res.send(buffer);
  } catch (err) {
    console.error("Export Elrajhi batch error:", err);
    return res.status(500).json({
      status: "failed",
      error: "Failed to generate export",
    });
  }
};

// List batches with counts to power the checker tab
exports.listElrajhiBatches = async (req, res) => {
  try {
    const ownerQuery = buildOwnerQuery(req.user || {});
    const ownerMatchStage = Object.keys(ownerQuery).length
      ? [{ $match: ownerQuery }]
      : [];
    const companyOfficeId = extractCompanyOfficeId(req);
    const matchStage = companyOfficeId
      ? [{ $match: { company_office_id: companyOfficeId } }]
      : [];

    const batches = await UrgentReport.aggregate([
      ...ownerMatchStage,
      ...matchStage,
      {
        $group: {
          _id: "$batch_id",
          totalReports: { $sum: 1 },
          withReportId: {
            $sum: {
              $cond: [{ $ifNull: ["$report_id", false] }, 1, 0],
            },
          },
          completedReports: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $eq: ["$submit_state", 1] },
                    { $eq: ["$report_status", "COMPLETE"] },
                    { $eq: ["$report_status", "SENT"] },
                    { $eq: ["$report_status", "CONFIRMED"] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          sentReports: {
            $sum: {
              $cond: [{ $eq: ["$report_status", "SENT"] }, 1, 0],
            },
          },
          confirmedReports: {
            $sum: {
              $cond: [{ $eq: ["$report_status", "CONFIRMED"] }, 1, 0],
            },
          },
          lastCreatedAt: { $max: "$createdAt" },
          excelName: { $first: "$source_excel_name" },
        },
      },
      { $sort: { lastCreatedAt: -1 } },
    ]);

    return res.json({
      status: "success",
      batches: batches.map((b) => ({
        batchId: b._id,
        totalReports: b.totalReports,
        withReportId: b.withReportId,
        completedReports: b.completedReports,
        sentReports: b.sentReports || 0,
        confirmedReports: b.confirmedReports || 0,
        excelName: b.excelName || "",
        lastCreatedAt: b.lastCreatedAt,
      })),
    });
  } catch (err) {
    console.error("List Elrajhi batches error:", err);
    return res.status(500).json({
      status: "failed",
      error: err.message || "Failed to list batches",
    });
  }
};

// Fetch reports inside a batch (used for expand view)
exports.getElrajhiBatchReports = async (req, res) => {
  try {
    const { batchId } = req.params;
    if (!batchId) {
      return res.status(400).json({
        status: "failed",
        error: "batchId is required",
      });
    }

    const companyOfficeId = extractCompanyOfficeId(req);
    const baseQuery = { batch_id: batchId };
    const ownerQuery = buildOwnerQuery(req.user || {});
    const query = Object.keys(ownerQuery).length
      ? { $and: [baseQuery, ownerQuery] }
      : baseQuery;
    if (companyOfficeId) {
      query.company_office_id = companyOfficeId;
    }

    const reports = await UrgentReport.find(query)
      .sort({ createdAt: 1 })
      .lean();

    const normalizeStatus = (report) => {
      const allowed = ["INCOMPLETE", "COMPLETE", "SENT", "CONFIRMED"];
      const raw = (report.report_status || report.status || "").toUpperCase();
      if (allowed.includes(raw)) return raw;
      return report.submit_state === 1 ? "COMPLETE" : "INCOMPLETE";
    };

    return res.json({
      status: "success",
      batchId,
      reports: reports.map((r) => {
        const reportStatus = normalizeStatus(r);
        return {
          id: r._id,
          batch_id: r.batch_id,
          title: r.title || "",
          value_premise_id: r.value_premise_id || 0,
          purpose_id: r.purpose_id || 0,
          valued_at: r.valued_at || null,
          submitted_at: r.submitted_at || null,
          inspection_date: r.inspection_date || null,
          assumptions: r.assumptions || 0,
          special_assumptions: r.special_assumptions || 0,
          report_id: r.report_id || "",
          client_name: r.client_name || "",
          asset_name: r.asset_name || "",
          value: r.final_value || 0,
          telephone: r.telephone || "",
          email: r.email || "",
          submit_state: typeof r.submit_state === "number" ? r.submit_state : 0,
          report_status: reportStatus,
          reportStatus,
          status: reportStatus,
          pdf_path: r.pdf_path || "",
          last_checked_at: r.last_checked_at,
        };
      }),
    });
  } catch (err) {
    console.error("Get Elrajhi batch reports error:", err);
    return res.status(500).json({
      status: "failed",
      error: err.message || "Failed to fetch batch reports",
    });
  }
};

exports.updateElrajhiReport = async (req, res) => {
  try {
    const { reportId } = req.params;
    if (!reportId) {
      return res.status(400).json({
        status: "failed",
        error: "reportId is required",
      });
    }

    const isMongoId = mongoose.Types.ObjectId.isValid(reportId);
    const companyOfficeId = extractCompanyOfficeId(req);
    const ownerQuery = buildOwnerQuery(req.user || {});
    const baseQuery = isMongoId
      ? { $or: [{ report_id: reportId }, { _id: reportId }] }
      : { report_id: reportId };
    const query = { ...baseQuery };
    if (companyOfficeId) {
      query.company_office_id = companyOfficeId;
    }
    if (Object.keys(ownerQuery).length) {
      query.$and = query.$and ? [...query.$and, ownerQuery] : [ownerQuery];
    }

    const report = await UrgentReport.findOne(query);

    if (!report) {
      return res.status(404).json({
        status: "failed",
        error: "Report not found",
      });
    }

    const body = req.body || {};
    const updates = {};

    const setField = (field, value, transform) => {
      if (value === undefined) return;
      const nextValue =
        typeof transform === "function" ? transform(value) : value;
      if (nextValue !== undefined) {
        updates[field] = nextValue;
      }
    };

    setField("report_id", body.report_id, (val) => {
      const trimmed = safeString(val).trim();
      return trimmed ? trimmed : undefined;
    });
    setField("title", body.title);
    setField("source_excel_name", body.source_excel_name);
    setField("batch_id", body.batch_id);
    setField("client_name", body.client_name);
    setField("purpose_id", body.purpose_id, toNumber);
    setField("value_premise_id", body.value_premise_id, toNumber);
    setField("report_type", body.report_type);
    setField("valued_at", body.valued_at, normalizeDateForUpdate);
    setField("submitted_at", body.submitted_at, normalizeDateForUpdate);
    setField("inspection_date", body.inspection_date, normalizeDateForUpdate);
    setField("assumptions", body.assumptions, toNumber);
    setField("special_assumptions", body.special_assumptions, toNumber);
    setField("number_of_macros", body.number_of_macros, toNumber);
    setField("telephone", body.telephone);
    setField("email", body.email, (val) => safeString(val).toLowerCase());
    setField("final_value", body.final_value ?? body.value, toNumber);
    setField("region", body.region);
    setField("city", body.city);
    setField("asset_id", body.asset_id, toNumber);
    setField("asset_name", body.asset_name);
    setField("asset_usage", body.asset_usage);
    setField("valuation_currency", body.valuation_currency);
    setField("report_status", body.report_status, (val) =>
      safeString(val).toUpperCase(),
    );

    if (body.submit_state !== undefined) {
      const submitState = toNumber(body.submit_state);
      if (submitState !== undefined) {
        updates.submit_state = submitState;
      }
    }

    if (body.last_checked_at) {
      const ts = new Date(body.last_checked_at);
      if (!isNaN(ts.getTime())) {
        updates.last_checked_at = ts;
      }
    }

    const cleanedValuers = cleanValuersPayload(body.valuers);
    if (cleanedValuers) {
      updates.valuers = cleanedValuers;
    }

    const uploadedPdfPath =
      (req.file && req.file.path) ||
      (req.files?.pdf && req.files.pdf[0]?.path) ||
      (req.files?.pdfs && req.files.pdfs[0]?.path);

    if (uploadedPdfPath) {
      updates.pdf_path = path.resolve(uploadedPdfPath);
    } else if (body.pdf_path !== undefined) {
      updates.pdf_path = body.pdf_path;
    }

    Object.assign(report, updates);
    await report.save();

    return res.json({
      status: "success",
      message: "Report updated successfully",
      report: report.toObject(),
    });
  } catch (err) {
    console.error("Update Elrajhi report error:", err);
    return res.status(500).json({
      status: "failed",
      error: err.message || "Failed to update report",
    });
  }
};

exports.getReportById = async (req, res) => {
  try {
    const { reportId } = req.params;
    if (!reportId) {
      return res.status(400).json({
        status: "failed",
        error: "reportId is required",
      });
    }

    const isMongoId = mongoose.Types.ObjectId.isValid(reportId);
    const companyOfficeId = extractCompanyOfficeId(req);
    const ownerQuery = buildOwnerQuery(req.user || {});
    const baseQuery = isMongoId
      ? { $or: [{ report_id: reportId }, { _id: reportId }] }
      : { report_id: reportId };
    const query = { ...baseQuery };
    if (companyOfficeId) {
      query.company_office_id = companyOfficeId;
    }
    if (Object.keys(ownerQuery).length) {
      query.$and = query.$and ? [...query.$and, ownerQuery] : [ownerQuery];
    }

    const report = await UrgentReport.findOne(query).lean();

    if (!report) {
      return res.status(404).json({
        status: "failed",
        error: "Report not found",
      });
    }

    return res.json({
      status: "success",
      report,
    });
  } catch (err) {
    console.error("Get report by ID error:", err);
    return res.status(500).json({
      status: "failed",
      error: err.message || "Failed to fetch report",
    });
  }
};
