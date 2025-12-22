const xlsx = require("xlsx");
const path = require("path");
const Report = require("../../infrastructure/models/UrgentReport");
const { title } = require("process");
const { randomUUID } = require("crypto");   // 👈 add this


function normalizeKey(str) {
  if (!str) return "";
  return str
    .toString()
    .normalize("NFC")      // normalize Unicode (important for Arabic)
    .replace(/\s+/g, " ")  // collapse multiple spaces
    .trim();
}


function parseExcelDate(value) {
  if (!value) return null;

  // Already a JS Date
  if (value instanceof Date) return value;

  // Excel serial number (e.g. 45263)
  if (typeof value === "number") {
    // Excel's epoch (1900 system) relative to JS epoch
    const excelEpoch = new Date(Date.UTC(1899, 11, 30)); // 1899-12-30
    const msPerDay = 24 * 60 * 60 * 1000;
    return new Date(excelEpoch.getTime() + value * msPerDay);
  }

  // String like "12/3/2024" (DD/MM/YYYY)
  if (typeof value === "string") {
    // Remove spaces
    const trimmed = value.trim();
    if (!trimmed) return null;

    // If it's a pure number as string, treat as Excel serial
    if (/^\d+$/.test(trimmed)) {
      const serial = parseInt(trimmed, 10);
      const excelEpoch = new Date(Date.UTC(1899, 11, 30));
      const msPerDay = 24 * 60 * 60 * 1000;
      return new Date(excelEpoch.getTime() + serial * msPerDay);
    }

    // Otherwise assume "DD/MM/YYYY" or "D/M/YYYY"
    const parts = trimmed.split(/[\/\-]/).map(p => p.trim());
    if (parts.length !== 3) return null;

    const [d, m, y] = parts.map(p => parseInt(p, 10));
    if (!d || !m || !y) return null;

    return new Date(y, m - 1, d); // JS months are 0-based
  }

  return null;
}





exports.processUpload = async (req, res) => {
  try {
    // ----------------------------------------------------
    // 0. Basic validation
    // ----------------------------------------------------
    if (!req.files || !req.files.excel || !req.files.excel[0]) {
      return res.status(400).json({
        status: "failed",
        error: "Excel file (field 'excel') is required",
      });
    }

    const batch_id = randomUUID();

    // ----------------------------------------------------
    // 1. Get Excel file & sheets
    // ----------------------------------------------------
    const excelFile = req.files.excel[0].path;
    const workbook = xlsx.readFile(excelFile);

    if (!workbook.Sheets["Report Info"] || !workbook.Sheets["market"]) {
      return res.status(400).json({
        status: "failed",
        error: "Excel must contain sheets named 'Report Info' and 'market'",
      });
    }

    const reportInfo = xlsx.utils.sheet_to_json(workbook.Sheets["Report Info"], {
      defval: "",
    });
    const marketSheet = xlsx.utils.sheet_to_json(workbook.Sheets["market"], {
      defval: "",
    });



    if (!reportInfo.length) {
      return res.status(400).json({
        status: "failed",
        error: "Sheet 'Report Info' is empty",
      });
    }

    const report = reportInfo[0];




    // Read raw values exactly as they come from Excel row
    const valuedAtRaw =
      report.valued_at ||
      report["valued_at\n"] ||
      report["Valued At"] ||
      "";

    const submittedAtRaw =
      report.submitted_at ||
      report["submitted_at\n"] ||
      report["Submitted At"] ||
      "";

    const inspectionDateRaw =
      report.inspection_date ||
      report["inspection_date\n"] ||
      report["Inspection Date"] ||
      "";

    // Convert to proper JS Date (from Excel serial or DD/MM/YYYY)
    const valued_at = parseExcelDate(valuedAtRaw);
    const submitted_at = parseExcelDate(submittedAtRaw);
    const inspection_date = parseExcelDate(inspectionDateRaw);

    console.log("valuedAt raw:", valuedAtRaw, "→", valued_at);
    console.log("submittedAt raw:", submittedAtRaw, "→", submitted_at);
    console.log("inspectionDate raw:", inspectionDateRaw, "→", inspection_date);



    console.log("Report Info rows:", reportInfo.length);
    console.log("Market sheet rows:", marketSheet.length);
    console.log(
      "First market row keys:",
      marketSheet[0] ? Object.keys(marketSheet[0]) : "NO ROWS"
    );

    // ----------------------------------------------------
    // 2. Extract asset rows – use actual column 'asset_name'
    // ----------------------------------------------------
    const assetRows = marketSheet.filter((r) => r.asset_name);

    console.log("Filtered asset rows:", assetRows.length);

    if (!assetRows.length) {
      console.log("❌ No asset rows found. Nothing to insert.");
      return res.status(400).json({
        status: "failed",
        error:
          "No asset rows found in 'market' sheet. Check column names / filter logic.",
      });
    }

    // ----------------------------------------------------
    // 3. Prepare PDF mapping (file name without extension must match asset_name)
    // ----------------------------------------------------
    // 3. Prepare PDF mapping
    // Helper to fix Latin1-misread UTF-8
    function fixMojibake(str) {
      if (!str) return "";
      // reinterpret string bytes as latin1, then decode as utf8
      return Buffer.from(str, "latin1").toString("utf8");
    }

    // 3. Prepare PDF mapping
    const pdfFiles = req.files["pdfs"] || [];
    const pdfMap = {};

    pdfFiles.forEach((file) => {
      const rawName = file.originalname;

      // Try to recover proper Arabic from mojibake
      const fixedName = fixMojibake(rawName);

      console.log("PDF rawName:", rawName);
      console.log("PDF fixedName:", fixedName);

      const baseName = path.parse(fixedName).name; // without extension
      const key = normalizeKey(baseName);          // normalized Arabic plate
      const fullPath = path.resolve(file.path);    // absolute path

      pdfMap[key] = fullPath;
    });

    console.log("PDF files received:", pdfFiles.length);
    console.log("PDF map keys (normalized):", Object.keys(pdfMap));


    // ----------------------------------------------------
    // 4. Build all documents for MongoDB
    // ----------------------------------------------------
    const docs = [];

    for (let i = 0; i < assetRows.length; i++) {
      const asset = assetRows[i];
      const asset_id = i + 1;

      // ✅ Asset code = Arabic plate number from asset_name
      // Prefer the column that actually matches your PDF names.
      // If your PDF names are like the plate number in asset_name, do:
      const rawCode =
        asset.asset_name ||                // 👈 use this if it matches PDFs
        asset["Origin/Asset Being Valued\n"] ||
        asset["code"] ||
        asset["code.1"] ||
        "";

      const trimmedCode = normalizeKey(rawCode);

      // ✅ Asset value from 'final_value'
      const final_value = Number(asset.final_value) || 0;

      // ✅ Modified client name
      const clientName = `${report.client_name} (${asset_id}) ${trimmedCode}`;

      // ✅ PDF mapping using asset_name
      const pdf_path = trimmedCode ? pdfMap[trimmedCode] || null : null;

      docs.push({
        batch_id,
        title: report.title,
        client_name: clientName,
        purpose_id: report.purpose_id,
        value_premise_id: report.value_premise_id,
        report_type: report.report_type,
        valued_at,
        submitted_at,
        inspection_date,
        number_of_macros: 1,

        assumptions: report.assumptions,
        special_assumptions: report.special_assumptions,
        telephone: report.telephone,
        email: report.email,

        final_value,

        region: report.region,
        city: report.city,

        asset_id,
        asset_name: trimmedCode, // ✅ now non-empty
        asset_usage:
          asset["asset_usage_id\n"]?.toString() || asset.asset_usage_id || "", // ✅ usage id

        pdf_path, // ✅ will be non-null if PDF filename matches asset_name
      });
    }

    // ----------------------------------------------------
    // 5. Insert into DB
    // ----------------------------------------------------
    if (!docs.length) {
      console.log("❌ No docs built from Excel. Nothing inserted.");
      return res.status(400).json({
        status: "failed",
        error: "No asset rows found to insert. Check Excel format / headers.",
      });
    }

    const result = await Report.insertMany(docs);

    console.log("====================================");
    console.log("📦 DB INSERT SUCCESS");
    console.log("Inserted:", result.length, "documents");
    console.log("Inserted records:");
    result.forEach((item, index) => {
      console.log(`  #${index + 1}:`, {
        id: item._id?.toString?.(),
        client_name: item.client_name,
        asset_code: item.asset_code,
        pdf_path: item.pdf_path,
      });
    });
    console.log("====================================");

    return res.json({
      status: "success",
      inserted: result.length,
      batchId: batch_id,
      data: result,
    });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ status: "failed", error: err.message });
  }
};
