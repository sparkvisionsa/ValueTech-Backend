const xlsx = require("xlsx");
const path = require("path");
const fs = require("fs");
const dummyPdfPath = path.resolve("uploads/static/dummy_placeholder.pdf");


const MultiApproachReport = require("../../infrastructure/models/MultiApproachReport");

// ------------ helpers ------------

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

function normalizeKey(str) {
  if (!str) return "";
  return str
    .toString()
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim();
}

// Robust Excel date parser (handles Date, Excel serial, xlsx cell objects, and common strings)
function parseExcelDate(value) {
  if (value === null || value === undefined || value === "") return null;

  // Already a proper Date
  if (value instanceof Date && !isNaN(value)) return value;

  // xlsx sometimes returns an object like { t: 'd', v: Date } or { v: serial, t: 'n' }
  if (typeof value === "object") {
    if (value.v !== undefined) {
      return parseExcelDate(value.v);
    }
    // if it's an object-wrapped Date
    if (value instanceof Date && !isNaN(value)) return value;
  }

  // Excel serial number (number of days since 1899-12-31, with 1900 leap-year bug)
  if (typeof value === "number") {
    const msPerDay = 24 * 60 * 60 * 1000;
    // Use 1899-12-30 as base and subtract 1 day for serials > 59 to account for Excel's 1900 leap-year bug
    const excelEpoch = Date.UTC(1899, 11, 30);
    const serial = value;
    const offsetSerial = serial > 59 ? serial - 1 : serial;
    const dt = new Date(excelEpoch + offsetSerial * msPerDay);
    return isNaN(dt.getTime()) ? null : dt;
  }

  // Strings: try common formats
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    // ISO-like yyyy-mm-dd or yyyy/mm/dd
    const iso = /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/.exec(trimmed);
    if (iso) {
      const y = parseInt(iso[1], 10);
      const m = parseInt(iso[2], 10);
      const d = parseInt(iso[3], 10);
      const dt = new Date(y, m - 1, d);
      return isNaN(dt.getTime()) ? null : dt;
    }

    // d/m/yyyy or m/d/yyyy (common slash or dash separated)
    const dmy = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/.exec(trimmed);
    if (dmy) {
      const p1 = parseInt(dmy[1], 10);
      const p2 = parseInt(dmy[2], 10);
      const y = parseInt(dmy[3], 10);

      // Heuristic: if first part > 12 treat it as day (DD/MM/YYYY). Otherwise assume day/month ordering
      // (this matches many locales where "09/09/2025" => day=9, month=9)
      let day = p1;
      let month = p2;
      if (p1 > 12 && p2 <= 12) {
        day = p1;
        month = p2;
      } else if (p2 > 12 && p1 <= 12) {
        // if second part > 12, swap (very rare)
        day = p2;
        month = p1;
      } else {
        // ambiguous: prefer DD/MM/YYYY (common outside US)
        day = p1;
        month = p2;
      }
      const dt = new Date(y, month - 1, day);
      return isNaN(dt.getTime()) ? null : dt;
    }

    // Last resort: let Date.parse try (handles "Sep 9 2025", etc.)
    const parsed = Date.parse(trimmed);
    return isNaN(parsed) ? null : new Date(parsed);
  }

  return null;
}

// Format JS Date -> "yyyy-mm-dd" string (returns "" for null/invalid)
function formatDateYyyyMmDd(value) {
  if (!value && value !== 0) return "";
  // If already a Date instance
  let dt = null;
  if (value instanceof Date) {
    dt = value;
  } else {
    // Try to parse (handles numbers, strings, and xlsx cell objects)
    dt = parseExcelDate(value);
  }

  if (!dt || isNaN(dt.getTime())) return "";

  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate() + 1).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function toSafeBasename(value, fallback) {
  const normalized = normalizeKey(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback || `manual-${Date.now()}`;
}


// Try to read total report value from Report Info row
function getReportTotalValue(reportRow) {
  // Adjust these keys to match your real Excel headers
  const raw =
    reportRow.value ||
    reportRow["value\n"] ||
    reportRow.final_value ||
    reportRow["final_value\n"] ||
    reportRow["Total Value"] ||
    reportRow["total_value"] ||
    0;

  const num = Number(raw);
  return Number.isNaN(num) ? 0 : num;
}

function toBooleanFlag(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return ["1", "true", "yes", "on"].includes(normalized);
  }
  return false;
}

function cleanStringArray(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((entry) => (entry == null ? "" : entry.toString().trim()))
    .filter(Boolean);
}

function normalizeValuers(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((valuer) => {
      if (!valuer) return null;
      const name =
        valuer.valuer_name ||
        valuer.valuerName ||
        valuer.name ||
        "";
      if (!name) return null;
      const pctRaw =
        valuer.contribution_percentage ??
        valuer.percentage ??
        valuer.contribution ??
        0;
      const contribution_percentage = Number(pctRaw);
      if (!Number.isFinite(contribution_percentage)) return null;
      return {
        valuer_name: name.toString().trim(),
        contribution_percentage,
      };
    })
    .filter((valuer) => valuer && valuer.valuer_name);
}

// ------------ main controller ------------

exports.processMultiApproachBatch = async (req, res) => {
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

    // 1) Build maps by basename (without extension)
    const excelMap = new Map(); // basename -> { file, pdfs: [] }
    excelFiles.forEach((file) => {
      const baseName = normalizeKey(path.parse(file.originalname).name);
      if (!excelMap.has(baseName)) {
        excelMap.set(baseName, { file, pdfs: [] });
      } else {
        // multiple Excel with same basename – adjust as you like
        throw badRequest(
          `Duplicate Excel base name detected: "${baseName}". Please ensure unique Excel file names.`
        );
      }
    });

    // Group PDFs by matching Excel basename
    const unmatchedPdfs = [];
    pdfFiles.forEach((file) => {
      const pdfBase = normalizeKey(path.parse(file.originalname).name);
      const bucket = excelMap.get(pdfBase);
      if (!bucket) {
        unmatchedPdfs.push(file.originalname);
      } else {
        bucket.pdfs.push(path.resolve(file.path));
      }
    });

    if (unmatchedPdfs.length > 0) {
      return res.status(400).json({
        status: "failed",
        error:
          "These PDFs do not match any Excel file by name: " +
          unmatchedPdfs.join(", "),
      });
    }


    excelMap.forEach((value, baseName) => {
  if (value.pdfs.length === 0) {
    value.pdfs.push(dummyPdfPath);
  }
});


    // Also ensure every Excel has at least one PDF (if that's required)
    const excelsWithoutPdf = [];
    for (const [baseName, value] of excelMap.entries()) {
      if (!value.pdfs.length) {
        excelsWithoutPdf.push(value.file.originalname);
      }
    }
    if (excelsWithoutPdf.length > 0) {
      return res.status(400).json({
        status: "failed",
        error:
          "These Excel files have no matching PDF: " +
          excelsWithoutPdf.join(", "),
      });
    }

    // 2) Generate batchId for this request
    const batchId = `ABM-${Date.now()}`;

    const docsToInsert = [];

    // 3) Process each Excel file
    for (const [baseName, { file, pdfs }] of excelMap.entries()) {
      const excelPath = file.path;
      let workbook;
      try {
        workbook = xlsx.readFile(excelPath);
      } catch (readErr) {
        throw badRequest(
          `Excel "${file.originalname}" could not be read. Please confirm it is a valid .xlsx/.xls file.`
        );
      }

      const reportSheet = workbook.Sheets["Report Info"];
      const marketSheet = workbook.Sheets["market"];
      const costSheet = workbook.Sheets["cost"];

      if (!reportSheet || !marketSheet || !costSheet) {
        return res.status(400).json({
          status: "failed",
          error: `Excel "${file.originalname}" must contain sheets 'Report Info', 'market', and 'cost'.`,
        });
      }

      const reportInfoRows = xlsx.utils.sheet_to_json(reportSheet, {
        defval: "",
      });
      if (!reportInfoRows.length) {
        return res.status(400).json({
          status: "failed",
          error: `Excel "${file.originalname}" has empty 'Report Info' sheet.`,
        });
      }
      const report = reportInfoRows[0];

      const marketRows = xlsx.utils.sheet_to_json(marketSheet, { defval: "" });
      const costRows = xlsx.utils.sheet_to_json(costSheet, { defval: "" });

      // 3.1 Parse basic report info
      const title = report.title || report["title\n"] || "";
      const client_name =
        report.client_name ||
        report["client_name\n"] ||
        report["Client Name"] ||
        "";

      const owner_name =
        report.owner_name ||
        report.client_name ||
        report["owner_name\n"] ||
        report["Owner Name"] ||
        "";

      const purpose_id = report.purpose_id || null;
      const value_premise_id = report.value_premise_id || null;
      const report_type = report.report_type || "";

      const valued_at = formatDateYyyyMmDd(
        parseExcelDate(
          report.valued_at ||
          report["valued_at\n"] ||
          report["Valued At"] ||
          report["valued at"]
        )
      );
      const submitted_at = formatDateYyyyMmDd(
        parseExcelDate(
          report.submitted_at ||
          report["submitted_at\n"] ||
          report["Submitted At"] ||
          report["submitted at"]
        )
      );
      const inspection_date = formatDateYyyyMmDd(
        parseExcelDate(
          report.inspection_date ||
          report["inspection_date\n"] ||
          report["Inspection Date"] ||
          report["inspection date"]
        )
      );

      const assumptions = report.assumptions || "";
      const special_assumptions = report.special_assumptions || "";
      const telephone = report.telephone || "";
      const email = report.email || "";

      const region = report.region || "";
      const city = report.city || "";

      const report_total_value = getReportTotalValue(report);

      // 3.2 Build assets from market + cost sheets
      const assets = [];
      let assets_total_value = 0;

      // --- market assets ---
      marketRows.forEach((row, index) => {
        const assetName = row.asset_name || row["asset_name\n"];
        if (!assetName) return;
        const asset_usage_id = row.asset_usage_id || null;

        if (!asset_usage_id) {
          throw badRequest(
            `Asset "${assetName}" missing asset usage id (asset_usage_id) in market sheet.`
          );
        }

        const final_value = Number(
          row.final_value || row["final_value\n"] || 0
        );
        assets_total_value += final_value;

        assets.push({
          asset_id: row.id || index + 1,
          asset_name: assetName,
          asset_usage_id: asset_usage_id,

          // repeated report-level fields
          region,
          city,
          owner_name,
          inspection_date, // yyyy-mm-dd

          source_sheet: "market",
          final_value,

          market_approach: "1",
          market_approach_value: final_value.toString(),



          production_capacity: "0",
          production_capacity_measuring_unit: "0",
          product_type: "0",

        });
      });

      // --- cost assets ---
      costRows.forEach((row, index) => {
        const assetName = row.asset_name || row["asset_name\n"];
        if (!assetName) return;

        const asset_usage_id = row.asset_usage_id || null;

        if (!asset_usage_id) {
          throw badRequest(
            `Asset "${assetName}" missing asset usage id (asset_usage_id) in cost sheet.`
          );
        }

        // 1) Extract original value
        const final_value_raw =
          row.final_value ||
          row["final_value\n"] ||
          row["Final Value"] ||
          row["value"] ||
          row["Value"] ||
          "";

        // 2) Ensure it's not empty
        if (final_value_raw === "" || final_value_raw === null) {
          throw badRequest(
            `Asset "${row.asset_name}" has no final_value. It must be an integer.`
          );
        }

        // 3) Convert to number
        const final_value_num = Number(final_value_raw);

        // 4) Must be a number
        if (isNaN(final_value_num)) {
          throw badRequest(
            `Asset "${row.asset_name}" has invalid final_value "${final_value_raw}". Must be an integer number.`
          );
        }

        // 5) Must be integer (no decimals allowed)
        if (!Number.isInteger(final_value_num)) {
          throw badRequest(
            `Asset "${row.asset_name}" has decimal final_value "${final_value_raw}". Only integer values are allowed.`
          );
        }

        // 6) Must be non-negative
        if (final_value_num <= 0) {
          throw badRequest(
            `Asset "${row.asset_name}" has negative final_value "${final_value_raw}". Not allowed.`
          );
        }

        const final_value = final_value_num; // SAFE INTEGER

        assets_total_value += final_value;

        assets.push({
          asset_id: row.id || index + 1, // note: may overlap with market; that's ok
          asset_name: assetName,
          asset_usage_id: asset_usage_id,

          // repeated report-level fields
          region,
          city,
          owner_name,
          inspection_date, // yyyy-mm-dd

          source_sheet: "cost",
          final_value,

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

      // 3.3 Validate total values match
      const diff = Math.abs(assets_total_value - report_total_value);
      if (diff > 0.01) {
        return res.status(400).json({
          status: "failed",
          error:
            `Excel "${file.originalname}" total assets value (${assets_total_value}) ` +
            `does not match Report Info total value (${report_total_value}).`,
        });
      }

      // If you want exactly one PDF per Excels:
      if (pdfs.length !== 1) {
        throw new Error(
          `Excel "${file.originalname}" must have exactly one matching PDF, but found ${pdfs.length}.`
        );
      }

      // 3.4 Build document for this Excel
      docsToInsert.push({
        batchId,
        excel_name: file.originalname,
        excel_basename: baseName,
        owner_name,

        title,
        client_name,
        purpose_id,
        value_premise_id,
        report_type,

        // already formatted as yyyy-mm-dd strings
        valued_at,
        submitted_at,
        inspection_date,

        assumptions,
        special_assumptions,
        telephone,
        email,

        region,
        city,

        final_value: report_total_value,
        assets_total_value,

        // renamed field to match schema
        asset_data: assets,

        // store single PDF path as string
        pdf_path: pdfs[0],

        // optionally, if your schema has it:
        // reportInfo_raw: report,
      });
    }

    // 4) Insert all docs
    const created = await MultiApproachReport.insertMany(docsToInsert);

    console.log("====================================");
    console.log("📦 MULTI APPROACH BATCH IMPORT SUCCESS");
    console.log("BatchId:", batchId);
    console.log("Inserted reports:", created.length);
    console.log("====================================");

    return res.json({
      status: "success",
      batchId,
      created: created.length,
      reports: created,
    });
  } catch (err) {
    console.error("Multi-approach batch upload error:", err);
    const statusCode = err?.statusCode && Number.isInteger(err.statusCode) ? err.statusCode : 500;
    return res.status(statusCode).json({
      status: "failed",
      error: err?.message || "Unexpected error",
    });
  }
};

exports.createManualMultiApproachReport = async (req, res) => {
  try {
    const assetsPayload = Array.isArray(req.body?.assets) ? req.body.assets : [];
    const reportInfo = req.body?.reportInfo || {};

    if (!assetsPayload.length) {
      throw badRequest("At least one asset row is required.");
    }

    const normalizedAssets = assetsPayload
      .map((row, index) => {
        if (!row) return null;

        const rawName =
          row.asset_name ||
          row.assetName ||
          row.name ||
          "";
        const asset_name = rawName.toString().trim();
        if (!asset_name) {
          throw badRequest(`Row ${index + 1}: asset_name is required.`);
        }

        const usageRaw =
          row.asset_usage_id ||
          row.assetUsageId ||
          row.asset_usage ||
          row.assetUsage;
        const asset_usage_id = Number(usageRaw);
        if (!Number.isInteger(asset_usage_id)) {
          throw badRequest(`Row ${index + 1}: asset_usage_id must be an integer.`);
        }

        const finalValueRaw =
          row.final_value ||
          row.value;
        const final_value = Number(finalValueRaw);
        if (!Number.isInteger(final_value) || final_value < 0) {
          throw badRequest(`Row ${index + 1}: final_value must be a non-negative integer.`);
        }

        const source =
          typeof row.source_sheet === "string" &&
            row.source_sheet.toLowerCase() === "cost"
            ? "cost"
            : "market";

        const assetDoc = {
          asset_id: row.asset_id || row.id || index + 1,
          asset_name,
          asset_usage_id,
          source_sheet: source,
          final_value,
          production_capacity: "0",
          production_capacity_measuring_unit: "0",
          product_type: "0",
        };

        if (row.owner_name || row.ownerName) {
          assetDoc.owner_name = (row.owner_name || row.ownerName || "").toString().trim();
        }
        if (row.region) {
          assetDoc.region = row.region.toString().trim();
        }
        if (row.city) {
          assetDoc.city = row.city.toString().trim();
        }
        if (row.inspection_date || row.inspectionDate) {
          assetDoc.inspection_date = formatDateYyyyMmDd(
            row.inspection_date || row.inspectionDate
          );
        }

        if (source === "cost") {
          assetDoc.cost_approach = "1";
          assetDoc.cost_approach_value = final_value.toString();
        } else {
          assetDoc.market_approach = "1";
          assetDoc.market_approach_value = final_value.toString();
        }

        return assetDoc;
      })
      .filter(Boolean);

    if (!normalizedAssets.length) {
      throw badRequest("No valid rows to import.");
    }

    const assets_total_value = normalizedAssets.reduce(
      (sum, asset) => sum + asset.final_value,
      0
    );

    const providedFinal = reportInfo.final_value ?? reportInfo.finalValue ?? reportInfo.value;
    const final_value =
      providedFinal === undefined || providedFinal === null || providedFinal === ""
        ? assets_total_value
        : Number(providedFinal);

    if (!Number.isInteger(final_value)) {
      throw badRequest("Report final_value must be an integer.");
    }

    if (Math.abs(final_value - assets_total_value) > 0.01) {
      throw badRequest(
        "Report final_value must match the sum of asset final_value entries."
      );
    }

    const valuation_currency =
      reportInfo.valuation_currency || reportInfo.currency_id || "to set";

    const report_users = cleanStringArray(reportInfo.report_users || reportInfo.reportUsers);
    const has_other_users =
      reportInfo.has_other_users !== undefined
        ? toBooleanFlag(reportInfo.has_other_users)
        : report_users.length > 0;

    const valuers = normalizeValuers(reportInfo.valuers);
    if (valuers.length) {
      const totalPct = valuers.reduce(
        (sum, v) => sum + Number(v.contribution_percentage || 0),
        0
      );
      const rounded = Math.round(totalPct);
      if (rounded !== 100) {
        throw badRequest(
          `Valuers contribution must sum to 100%. Currently ${totalPct}%.`
        );
      }
    }

    const timestamp = Date.now();
    const manualTitle = reportInfo.title || "Manual Report";
    const rawExcelName =
      reportInfo.excel_name ||
      reportInfo.excelName ||
      `${manualTitle || "manual-report"}-${timestamp}`;
    const ext = path.extname(rawExcelName).toLowerCase();
    const excel_name =
      ext === ".xlsx" || ext === ".xls"
        ? rawExcelName
        : `${rawExcelName}.xlsx`;
    const excel_basename = toSafeBasename(
      reportInfo.excel_basename || reportInfo.excelBasename || rawExcelName,
      `manual-${timestamp}`
    );

    const batchId =
      (reportInfo.batchId || reportInfo.batch_id || "")
        .toString()
        .trim() || `MAN-${timestamp}`;

    const region = reportInfo.region || "";
    const city = reportInfo.city || "";
    const owner_name = reportInfo.owner_name || reportInfo.client_name || "";

    const doc = {
      batchId,
      excel_name,
      excel_basename,
      title: manualTitle,
      client_name: reportInfo.client_name || "",
      owner_name,
      purpose_id: reportInfo.purpose_id || null,
      value_premise_id: reportInfo.value_premise_id || null,
      report_type: reportInfo.report_type || "",
      valued_at: formatDateYyyyMmDd(reportInfo.valued_at),
      submitted_at: formatDateYyyyMmDd(reportInfo.submitted_at),
      inspection_date: formatDateYyyyMmDd(reportInfo.inspection_date),
      assumptions: reportInfo.assumptions || "",
      special_assumptions: reportInfo.special_assumptions || "",
      telephone: reportInfo.telephone || "",
      email: reportInfo.email || "",
      region,
      city,
      valuation_currency,
      has_other_users,
      report_users,
      valuers,
      value: final_value,
      final_value,
      assets_total_value,
      pdf_path: reportInfo.pdf_path || "",
      asset_data: normalizedAssets.map((asset) => ({
        ...asset,
        region: asset.region || region,
        city: asset.city || city,
        owner_name: asset.owner_name || owner_name,
        inspection_date:
          asset.inspection_date || formatDateYyyyMmDd(reportInfo.inspection_date),
      })),
    };

    const created = await MultiApproachReport.create(doc);

    return res.json({
      status: "success",
      batchId,
      created: 1,
      reports: [created],
    });
  } catch (err) {
  console.error("Multi-approach batch upload error:", err);

  if (err.name === "ValidationError") {
    // Collect all field-specific messages
    const messages = Object.values(err.errors).map((e) => e.message);

    return res.status(400).json({
      status: "failed",
      error: messages.join("Date Validation Error: Date of Valuation must be on or before Report Issuing Date"),
    });
  }

  const statusCode =
    err?.statusCode && Number.isInteger(err.statusCode) ? err.statusCode : 500;

  return res.status(statusCode).json({
    status: "failed",
    error: err?.message || "Unexpected error",
  });
}

};
