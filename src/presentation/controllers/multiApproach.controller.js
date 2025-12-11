const xlsx = require("xlsx");
const path = require("path");
const fs = require("fs");

const MultiApproachReport = require("../../infrastructure/models/MultiApproachReport");

// ------------ helpers ------------

function normalizeKey(str) {
  if (!str) return "";
  return str
    .toString()
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim();
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

// Format JS Date -> "yyyy-mm-dd" string (or "" if null/invalid)
function formatDateYyyyMmDd(value) {
  if (!value) return "";
  if (!(value instanceof Date)) return value; // assume already formatted string
  const yyyy = value.getFullYear();
  const mm = String(value.getMonth() + 1).padStart(2, "0");
  const dd = String(value.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
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
        throw new Error(
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
      const workbook = xlsx.readFile(excelPath);

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
        console.log(asset_usage_id);

        if (!asset_usage_id) {
          throw new Error(
            `Asset "${row.asset_name}" missing asset usaage id`
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
        console.log(asset_usage_id);

        if (!asset_usage_id) {
          throw new Error(
            `Asset "${row.asset_name}" missing asset usaage id`
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
          throw new Error(
            `Asset "${row.asset_name}" has no final_value. It must be an integer.`
          );
        }

        // 3) Convert to number
        const final_value_num = Number(final_value_raw);

        // 4) Must be a number
        if (isNaN(final_value_num)) {
          throw new Error(
            `Asset "${row.asset_name}" has invalid final_value "${final_value_raw}". Must be an integer number.`
          );
        }

        // 5) Must be integer (no decimals allowed)
        if (!Number.isInteger(final_value_num)) {
          throw new Error(
            `Asset "${row.asset_name}" has decimal final_value "${final_value_raw}". Only integer values are allowed.`
          );
        }

        // 6) Must be non-negative
        if (final_value_num < 0) {
          throw new Error(
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

      // If you want exactly one PDF per Excel, uncomment this:
      // if (pdfs.length !== 1) {
      //   throw new Error(
      //     `Excel "${file.originalname}" must have exactly one matching PDF, but found ${pdfs.length}.`
      //   );
      // }

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
    return res.status(500).json({
      status: "failed",
      error: err.message,
    });
  }
};