// src/presentation/controllers/elrajhiBatch.controller.js
const xlsx = require("xlsx");
const path = require("path");
const fs = require("fs");

const UrgentReport = require("../../infrastructure/models/UrgentReport");

// ---------- helpers ----------

function normalizeKey(str) {
  if (!str) return "";
  return str
    .toString()
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim();
}

function getPlaceholderPdfPath() {
  const placeholderPath = path.resolve(
    "uploads",
    "static",
    "dummy_placeholder.pdf"
  );

  if (!fs.existsSync(placeholderPath)) {
    throw new Error(
      "Placeholder PDF missing at uploads/static/dummy_placeholder.pdf"
    );
  }

  return placeholderPath;
}


// 🔹 Same mojibake fix you used in processUpload
function fixMojibake(str) {
  if (!str) return "";
  // reinterpret string bytes as latin1, then decode as utf8
  return Buffer.from(str, "latin1").toString("utf8");
}

function parseExcelDate(value) {
  if (!value) return null;

  if (value instanceof Date) return value;

  if (typeof value === "number") {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30)); // 1899-12-30
    const msPerDay = 24 * 60 * 60 * 1000;
    return new Date(excelEpoch.getTime() + value * msPerDay);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    if (/^\d+$/.test(trimmed)) {
      const serial = parseInt(trimmed, 10);
      const excelEpoch = new Date(Date.UTC(1899, 11, 30));
      const msPerDay = 24 * 60 * 60 * 1000;
      return new Date(excelEpoch.getTime() + serial * msPerDay);
    }

    const parts = trimmed.split(/[\/\-]/).map((p) => p.trim());
    if (parts.length !== 3) return null;

    const [d, m, y] = parts.map((p) => parseInt(p, 10));
    if (!d || !m || !y) return null;

    return new Date(y, m - 1, d);
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

  const hasBaseId = idKeys.some((k) => k.split("_")[0] === "valuerId");
  const hasBaseName = nameKeys.some((k) => k.split("_")[0] === "valuerName");
  const hasBasePct = pctKeys.some((k) => k.split("_")[0] === "percentage");

  if (!hasBaseId || !hasBaseName || !hasBasePct) {
    throw new Error(
      "Market sheet must contain headers 'valuerId', 'valuerName', and 'percentage'. " +
      "If there are multiple valuers, Excel will create valuerId_1, valuerId_2, etc."
    );
  }

  return { idKeys, nameKeys, pctKeys };
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
      pctString
        .replace(/[%٪]/g, "")
        .replace(/,/g, ".")
        .trim()
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

    if (!userPhone) {
      return res.status(400).json({
        status: "failed",
        error: "User phone is required to submit reports.",
      });
    }

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

    const reportInfoRows = xlsx.utils.sheet_to_json(reportSheet, { defval: "" });
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
      report["valued at"]
    );
    const submitted_at = parseExcelDate(
      report.submitted_at ||
      report["submitted_at\n"] ||
      report["Submitted At"] ||
      report["submitted at"]
    );
    const inspection_date = parseExcelDate(
      report.inspection_date ||
      report["inspection_date\n"] ||
      report["Inspection Date"] ||
      report["inspection date"]
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

    // 4) Build pdfMap from uploaded PDFs (with mojibake fix)
    const pdfMap = {};
    pdfFiles.forEach((file) => {
      const rawName = file.originalname;          // e.g. "Ø¯ Ù Øµ 1220.pdf"
      const fixedName = fixMojibake(rawName);     // "د م ص 1220.pdf" (hopefully)

      console.log("PDF rawName:", rawName);
      console.log("PDF fixedName:", fixedName);

      const baseName = path.parse(fixedName).name; // without extension
      const key = normalizeKey(baseName);
      const fullPath = path.resolve(file.path);
      pdfMap[key] = fullPath;
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

      // 🔹 Build valuers[] for this asset
      const valuers = buildValuersForAsset(assetRow, valuerCols);

      if (!valuers.length) {
        return res.status(400).json({
          status: "failed",
          error: `Asset "${assetName}" (row ${index + 1}) has no valuers. At least one valuer is required.`,
        });
      }

      const totalPct = valuers.reduce(
        (sum, v) => sum + (Number(v.percentage) || 0),
        0
      );

      const roundedTotal = Math.round(totalPct * 100) / 100;

      // allow tiny floating error, but must be 100
      if (Math.abs(roundedTotal - 100) > 0.001) {
        return res.status(400).json({
          status: "failed",
          error: `Asset "${assetName}" (row ${index + 1
            }) has total valuers percentage = ${roundedTotal}%. It must be exactly 100%.`,
        });
      }

      // ---- PDF resolution ----
      const assetKey = assetName; // already normalized
      let pdf_path = pdfMap[assetKey] || null;

      if (!pdf_path) {
        console.warn(
          "No PDF found for asset:",
          assetName,
          "using dummy-placeholder.pdf"
        );
        pdf_path = getPlaceholderPdfPath();
      }


      docs.push({
        batch_id,
        source_excel_name: sourceExcelName,
        number_of_macros: 1,
        user_id: userId,
        user_phone: userPhone,
        company: userContext.company || null,

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
      { $set: { user_phone: userPhone, user_id: userId } }
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

    const reports = await UrgentReport.find({ batch_id: batchId })
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
    const rows = reports.map((r, idx) => ([
      idx + 1,
      r.asset_name || "",
      r.client_name || "",
      r.report_id || "",
    ]));

    const ws = xlsx.utils.aoa_to_sheet([header, ...rows]);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "Reports");

    const buffer = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName}"`
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
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
    const batches = await UrgentReport.aggregate([
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

    const reports = await UrgentReport.find({ batch_id: batchId })
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

exports.getReportById = async (req, res) => {
  try {
    const { reportId } = req.params;
    if (!reportId) {
      return res.status(400).json({
        status: "failed",
        error: "reportId is required",
      });
    }

    const report = await UrgentReport.findOne({ report_id: reportId })
      .lean();

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