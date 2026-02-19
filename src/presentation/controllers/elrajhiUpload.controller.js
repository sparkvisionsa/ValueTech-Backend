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

function fixMojibake(str) {
  if (!str) return "";
  return Buffer.from(str, "latin1").toString("utf8");
}

function toYMDFromDate(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function parseExcelDate(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return toYMDFromDate(value);
  }

  if (typeof value === "number") {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const msPerDay = 24 * 60 * 60 * 1000;
    const d = new Date(excelEpoch.getTime() + value * msPerDay);
    return toYMDFromDate(d);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    if (/^\d+$/.test(trimmed)) {
      const serial = parseInt(trimmed, 10);
      const excelEpoch = new Date(Date.UTC(1899, 11, 30));
      const msPerDay = 24 * 60 * 60 * 1000;
      const d = new Date(excelEpoch.getTime() + serial * msPerDay);
      return toYMDFromDate(d);
    }

    const parts = trimmed.split(/[\/\-]/).map((p) => p.trim());
    if (parts.length !== 3) return null;

    const [dStr, mStr, yStr] = parts;
    const dNum = parseInt(dStr, 10);
    const mNum = parseInt(mStr, 10);
    const yNum = parseInt(yStr, 10);
    if (!dNum || !mNum || !yNum) return null;

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
    fs.writeFileSync(tempPath, "");
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

function detectValuerColumnsOrThrow(exampleRow) {
  const keys = Object.keys(exampleRow || {});
  const idKeys = [];
  const nameKeys = [];
  const pctKeys = [];

  for (const k of keys) {
    const base = k.split("_")[0];
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

  if (!nameKeys.length || !pctKeys.length) {
    throw new Error(
      "Market sheet must contain headers 'valuerName' and 'percentage'. " +
        "If there are multiple valuers, Excel will create valuerName_1, percentage_1, etc.",
    );
  }

  const allKeys = Array.from(new Set([...idKeys, ...nameKeys, ...pctKeys]));
  return { idKeys, nameKeys, pctKeys, allKeys, hasValuerColumns: true };
}

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

    if (allEmpty) continue;

    const pctString = convertArabicDigits(String(pctRaw ?? "")).trim();
    if (!pctString) continue;

    const pctNum = Number(
      pctString.replace(/[%٪]/g, "").replace(/,/g, ".").trim(),
    );

    if (Number.isNaN(pctNum)) continue;

    const percentage = pctNum >= 0 && pctNum <= 1 ? pctNum * 100 : pctNum;

    valuers.push({
      valuerId: id != null && id !== "" ? String(id) : "",
      valuerName: name || "",
      percentage,
    });
  }

  return valuers;
}

// ---------- Body key decoder ----------
//
// multipart/form-data body keys containing Arabic arrive as mojibake:
// their UTF-8 bytes were interpreted as latin1 by the HTTP parser.
// e.g. "ر ق ط 6835" arrives as "Ø± Ù\x82 Ø· 6835"
//
// Strategy: build a Map whose keys are ALL of:
//   1. the raw key as-received (handles plain ASCII like "test1")
//   2. fixMojibake(rawKey)  – the correctly decoded Arabic string
//   3. normalizeKey() variants of both (NFC + collapse spaces)
//   4. no-spaces variants of both
//
// Lookups must go through this map, never req.body[key] directly.

function buildDecodedBodyMap(body) {
  const map = new Map();

  for (const [rawKey, value] of Object.entries(body || {})) {
    if (typeof value !== "string") continue;

    const decodedKey = fixMojibake(rawKey);

    // All key variants we want to be able to look up by
    const variants = [
      rawKey,
      decodedKey,
      normalizeKey(rawKey),
      normalizeKey(decodedKey),
      rawKey.replace(/\s+/g, ""),
      decodedKey.replace(/\s+/g, ""),
    ];

    for (const v of variants) {
      if (v && !map.has(v)) {
        map.set(v, value);
      }
    }
  }

  return map;
}

// ---------- main controller ----------

exports.processElrajhiExcel = async (req, res) => {
  try {
    // ============= STARTUP LOGGING =============
    console.log("\n" + "=".repeat(80));
    console.log("body", req.body);
    console.log("📥 ELRAJHI BATCH UPLOAD REQUEST RECEIVED");
    console.log("=".repeat(80));
    console.log(`🕐 Timestamp: ${new Date().toISOString()}`);
    console.log(`👤 User: ${req.user?.id || req.user?._id || "anonymous"}`);
    console.log(
      `🏢 Company Office ID: ${extractCompanyOfficeId(req) || "none"}`,
    );

    // ============= BUILD DECODED BODY MAP =============
    // Keys with Arabic text arrive as mojibake — decode them all upfront.
    // Every subsequent lookup uses decodedBody.get(key) instead of req.body[key].
    const decodedBody = buildDecodedBodyMap(req.body);

    console.log("\n🔑 DECODED BODY MAP:");
    for (const [k, v] of decodedBody.entries()) {
      if (v.includes("/") || v.includes("\\")) {
        console.log(`  "${k}" -> "${v}"`);
      }
    }

    // Log files received
    console.log("\n📁 FILES RECEIVED:");
    console.log(`  - Excel files: ${req.files?.excel?.length || 0}`);
    if (req.files?.excel?.length) {
      req.files.excel.forEach((file, idx) => {
        console.log(
          `    Excel ${idx + 1}: ${file.originalname} (${file.size} bytes)`,
        );
      });
    }

    console.log(`\n  - PDF files: ${req.files?.pdfs?.length || 0}`);
    if (req.files?.pdfs?.length) {
      req.files.pdfs.forEach((file, idx) => {
        const fixedName = fixMojibake(file.originalname);
        console.log(
          `    PDF ${idx + 1}: raw="${file.originalname}" fixed="${fixedName}" path="${file.path}"`,
        );
      });
    } else {
      console.log(`    No PDF files uploaded`);
    }

    // 0) Validate files
    if (!req.files || !req.files.excel || !req.files.excel[0]) {
      console.error("❌ Validation failed: No Excel file provided");
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

    const excelFile = req.files.excel[0].path;
    const sourceExcelName = req.files.excel[0].originalname || "elrajhi.xlsx";
    const pdfFiles = req.files.pdfs || [];

    console.log(`\n📂 Excel: ${sourceExcelName} | PDFs: ${pdfFiles.length}`);

    // 1) Read Excel
    console.log("\n📖 Reading Excel file...");
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

    console.log(`  - Report Info rows: ${reportInfoRows.length}`);
    console.log(`  - Market rows: ${marketRows.length}`);

    if (!reportInfoRows.length) {
      return res
        .status(400)
        .json({ status: "failed", error: "Sheet 'Report Info' is empty" });
    }
    if (!marketRows.length) {
      return res
        .status(400)
        .json({ status: "failed", error: "Sheet 'market' has no asset rows" });
    }

    const report = reportInfoRows[0];

    // 2) Parse dates
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

    console.log(
      `\n📅 valued_at=${valued_at} submitted_at=${submitted_at} inspection_date=${inspection_date}`,
    );

    // 3) Detect valuer columns
    let valuerCols;
    try {
      valuerCols = detectValuerColumnsOrThrow(marketRows[0]);
    } catch (e) {
      return res.status(400).json({ status: "failed", error: e.message });
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

    // ============= PDF MAPPING WITH MOJIBAKE-AWARE PATH RESOLUTION =============
    console.log("\n" + "=".repeat(80));
    console.log("📄 PDF MAPPING");
    console.log("=".repeat(80));

    const pdfMap = new Map(); // lookup key  -> absolute path
    const pdfOriginalNames = new Map(); // lookup key  -> display filename
    const pdfPathSource = new Map(); // lookup key  -> "user_system" | "backend_upload"

    pdfFiles.forEach((file, idx) => {
      const rawName = file.originalname;
      const fixedName = fixMojibake(rawName);
      const parsedPath = path.parse(fixedName);
      const baseName = parsedPath.name;
      const ext = parsedPath.ext;

      console.log(`\n[PDF ${idx + 1}]`);
      console.log(
        `  raw="${rawName}" | fixed="${fixedName}" | base="${baseName}"`,
      );

      // Generate all key variants for this PDF filename.
      // These are the keys we'll store in pdfMap AND the keys we'll look up
      // in decodedBody to find the user's absolute path.
      const fileKeyVariants = [
        fixedName,
        baseName,
        normalizeKey(fixedName),
        normalizeKey(baseName),
        fixedName.replace(/\s+/g, ""),
        baseName.replace(/\s+/g, ""),
        `${baseName}${ext}`,
      ].filter((k) => k && k.trim());

      // Find the absolute path the frontend sent for this PDF.
      // decodedBody already has keys in all variants (raw, fixed, normalized, no-spaces)
      // so a simple .get() across our filename variants is enough.
      let absolutePath = null;
      let matchedBodyKey = null;

      for (const variant of fileKeyVariants) {
        const found = decodedBody.get(variant);
        if (found && found !== "undefined" && found !== "null") {
          absolutePath = found;
          matchedBodyKey = variant;
          break;
        }
      }

      const finalPath = absolutePath || path.resolve(file.path);
      const pathSource = absolutePath ? "user_system" : "backend_upload";

      if (absolutePath) {
        console.log(
          `  ✅ Matched body key="${matchedBodyKey}" -> "${absolutePath}"`,
        );
      } else {
        console.log(
          `  ⚠️  No body match found — using backend upload path: "${finalPath}"`,
        );
      }

      // Store every key variant in pdfMap so asset matching can find this PDF
      const uniqueKeys = [...new Set(fileKeyVariants)];
      uniqueKeys.forEach((key) => {
        pdfMap.set(key, finalPath);
        pdfOriginalNames.set(key, fixedName);
        pdfPathSource.set(key, pathSource);
      });

      console.log(
        `  Stored under ${uniqueKeys.length} key(s): ${uniqueKeys.slice(0, 4).join(" | ")}${uniqueKeys.length > 4 ? "..." : ""}`,
      );
    });
    const knownNonPathFields = new Set([
      "valuers",
      "excel",
      "pdfs",
      "companyOfficeId",
      "company_office_id",
    ]);
    for (const [key, value] of decodedBody.entries()) {
      if (knownNonPathFields.has(key)) continue;
      // Only treat as a path if the value looks like an absolute path
      if (!value || (!value.startsWith("/") && !value.match(/^[A-Za-z]:\\/)))
        continue;
      // Skip if already registered (real PDF upload takes precedence)
      if (pdfMap.has(key)) continue;

      console.log(`\n[Body path] key="${key}" -> "${value}"`);
      pdfMap.set(key, value);
      pdfOriginalNames.set(key, "dummy_placeholder.pdf");
      pdfPathSource.set(key, "dummy");
    }

    console.log(`\n📊 pdfMap size: ${pdfMap.size}`);
    console.log(`\n📊 pdfMap size: ${pdfMap.size}`);
    console.log(`   Keys: ${Array.from(pdfMap.keys()).join(" | ")}`);
    console.log("=".repeat(80) + "\n");

    // 4) Generate batch_id
    const batch_id = `ELR-${Date.now()}`;
    console.log(`🆔 batch_id: ${batch_id}`);

    // 5) Build one doc per asset row
    const docs = [];
    let userSystemPathMatches = 0;
    let backendPathMatches = 0;
    let placeholderMatches = 0;

    console.log("\n" + "=".repeat(80));
    console.log("🔍 ASSET → PDF MATCHING");
    console.log("=".repeat(80));

    for (let index = 0; index < marketRows.length; index++) {
      const assetRow = marketRows[index];
      const originalAssetName = assetRow.asset_name;

      if (!originalAssetName) {
        console.log(`[Asset ${index + 1}] ⚠️ Skipping — no asset_name`);
        continue;
      }

      const asset_id = assetRow.id || index + 1;
      const value = Number(assetRow.final_value) || 0;

      console.log(`\n[Asset ${index + 1}] "${originalAssetName}"`);

      const baseClientName =
        report.client_name ||
        report["client_name\n"] ||
        report["Client Name"] ||
        "";
      const client_name = `${baseClientName} (${asset_id}) ${originalAssetName}`;
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
          const v = assetRow[key];
          return v !== null && v !== undefined && String(v).trim() !== "";
        });

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
        if (Math.abs(roundedTotal - 100) > 0.001) {
          return res.status(400).json({
            status: "failed",
            error: `Asset "${originalAssetName}" (row ${index + 1}) valuer total = ${roundedTotal}%. Must be 100%.`,
          });
        }
      }

      // --- PDF matching ---
      // Build lookup key variants for this asset name, mirroring what we stored in pdfMap.
      const normalizedAssetName = normalizeKey(originalAssetName);

      const assetKeyVariants = [
        originalAssetName,
        `${originalAssetName}.pdf`,
        originalAssetName.replace(/\s+/g, ""),
        `${originalAssetName.replace(/\s+/g, "")}.pdf`,
        normalizedAssetName,
        `${normalizedAssetName}.pdf`,
        normalizedAssetName.replace(/\s+/g, ""),
        `${normalizedAssetName.replace(/\s+/g, "")}.pdf`,
      ];

      let pdf_path = null;
      let originalPdfName = null;
      let pathSource = null;

      // Exact match
      for (const key of assetKeyVariants) {
        if (pdfMap.has(key)) {
          pdf_path = pdfMap.get(key);
          originalPdfName = pdfOriginalNames.get(key);
          pathSource = pdfPathSource.get(key);
          console.log(`  ✅ EXACT match on key="${key}"`);
          break;
        }
      }

      // Fuzzy match fallback
      if (!pdf_path) {
        const allPdfKeys = Array.from(pdfMap.keys());
        for (const pdfKey of allPdfKeys) {
          if (
            pdfKey.includes(originalAssetName) ||
            originalAssetName.includes(pdfKey) ||
            pdfKey.includes(normalizedAssetName) ||
            normalizedAssetName.includes(pdfKey)
          ) {
            pdf_path = pdfMap.get(pdfKey);
            originalPdfName = pdfOriginalNames.get(pdfKey);
            pathSource = pdfPathSource.get(pdfKey);
            console.log(`  🔍 FUZZY match on pdfKey="${pdfKey}"`);
            break;
          }
        }
      }

      if (pdf_path) {
        if (pathSource === "user_system") userSystemPathMatches++;
        else backendPathMatches++;
        console.log(`  📄 PDF: ${pathSource} -> "${pdf_path}"`);
      } else {
        pdf_path = getPlaceholderPdfPath();
        originalPdfName = "dummy_placeholder.pdf";
        pathSource = "placeholder";
        placeholderMatches++;
        console.log(`  📄 PDF: placeholder -> "${pdf_path}"`);
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

        final_value: value,
        asset_id,
        asset_name: normalizedAssetName,
        asset_original_name: originalAssetName,
        asset_usage,

        asset: assetRow,
        valuers,

        pdf_path,
        pdf_original_name: originalPdfName,
        pdf_source: pathSource,

        submit_state: 0,
        report_status: "INCOMPLETE",
      });
    }

    console.log("\n" + "=".repeat(80));
    console.log(
      `📊 Assets: ${docs.length} | user_system: ${userSystemPathMatches} | backend: ${backendPathMatches} | placeholder: ${placeholderMatches}`,
    );
    console.log("=".repeat(80));

    if (!docs.length) {
      return res
        .status(400)
        .json({ status: "failed", error: "No valid asset rows found." });
    }

    // 6) Insert into DB
    console.log("\n💾 Inserting...");
    const created = await UrgentReport.insertMany(docs);

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

    console.log(`✅ Inserted ${created.length} reports`);

    const pathSources = docs.reduce((acc, doc) => {
      const src = doc.pdf_source || "unknown";
      acc[src] = (acc[src] || 0) + 1;
      return acc;
    }, {});

    return res.json({
      status: "success",
      batchId: batch_id,
      created: created.length,
      excelName: sourceExcelName,
      downloadPath: `/api/elrajhi-upload/export/${batch_id}`,
      summary: {
        totalReports: created.length,
        pathSources,
        userSystemPaths: userSystemPathMatches,
        backendPaths: backendPathMatches,
        placeholders: placeholderMatches,
        sampleAssets: docs.slice(0, 3).map((d) => ({
          name: d.asset_original_name,
          pdfSource: d.pdf_source,
          pdfPath: d.pdf_path,
        })),
      },
      reports: created.map((report) => ({
        ...report.toObject(),
        asset_name: report.asset_original_name || report.asset_name,
        pdf_name: report.pdf_original_name,
        pdf_source: report.pdf_source,
      })),
    });
  } catch (err) {
    console.error("\n❌ ELRAJHI BATCH UPLOAD ERROR:", err);
    return res.status(500).json({ status: "failed", error: err.message });
  }
};

// Export a simple Excel with asset, client, and report IDs (no PDF path)
exports.exportElrajhiBatch = async (req, res) => {
  try {
    const { batchId } = req.params;
    if (!batchId) {
      return res
        .status(400)
        .json({ status: "failed", error: "batchId is required" });
    }

    const companyOfficeId = extractCompanyOfficeId(req);
    const baseQuery = { batch_id: batchId };
    const ownerQuery = buildOwnerQuery(req.user || {});
    const query = Object.keys(ownerQuery).length
      ? { $and: [baseQuery, ownerQuery] }
      : baseQuery;
    if (companyOfficeId) query.company_office_id = companyOfficeId;

    const reports = await UrgentReport.find(query)
      .sort({ asset_id: 1, createdAt: 1 })
      .lean();

    if (!reports.length) {
      return res
        .status(404)
        .json({ status: "failed", error: "No reports found for this batch." });
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
    return res
      .status(500)
      .json({ status: "failed", error: "Failed to generate export" });
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
            $sum: { $cond: [{ $ifNull: ["$report_id", false] }, 1, 0] },
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
            $sum: { $cond: [{ $eq: ["$report_status", "SENT"] }, 1, 0] },
          },
          confirmedReports: {
            $sum: { $cond: [{ $eq: ["$report_status", "CONFIRMED"] }, 1, 0] },
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
      return res
        .status(400)
        .json({ status: "failed", error: "batchId is required" });
    }

    const companyOfficeId = extractCompanyOfficeId(req);
    const baseQuery = { batch_id: batchId };
    const ownerQuery = buildOwnerQuery(req.user || {});
    const query = Object.keys(ownerQuery).length
      ? { $and: [baseQuery, ownerQuery] }
      : baseQuery;
    if (companyOfficeId) query.company_office_id = companyOfficeId;

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
      return res
        .status(400)
        .json({ status: "failed", error: "reportId is required" });
    }

    const isMongoId = mongoose.Types.ObjectId.isValid(reportId);
    const companyOfficeId = extractCompanyOfficeId(req);
    const ownerQuery = buildOwnerQuery(req.user || {});
    const baseQuery = isMongoId
      ? { $or: [{ report_id: reportId }, { _id: reportId }] }
      : { report_id: reportId };
    const query = { ...baseQuery };
    if (companyOfficeId) query.company_office_id = companyOfficeId;
    if (Object.keys(ownerQuery).length) {
      query.$and = query.$and ? [...query.$and, ownerQuery] : [ownerQuery];
    }

    const report = await UrgentReport.findOne(query);
    if (!report) {
      return res
        .status(404)
        .json({ status: "failed", error: "Report not found" });
    }

    const body = req.body || {};
    const updates = {};

    const setField = (field, value, transform) => {
      if (value === undefined) return;
      const nextValue =
        typeof transform === "function" ? transform(value) : value;
      if (nextValue !== undefined) updates[field] = nextValue;
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
      if (submitState !== undefined) updates.submit_state = submitState;
    }

    if (body.last_checked_at) {
      const ts = new Date(body.last_checked_at);
      if (!isNaN(ts.getTime())) updates.last_checked_at = ts;
    }

    const cleanedValuers = cleanValuersPayload(body.valuers);
    if (cleanedValuers) updates.valuers = cleanedValuers;

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
      return res
        .status(400)
        .json({ status: "failed", error: "reportId is required" });
    }

    const isMongoId = mongoose.Types.ObjectId.isValid(reportId);
    const companyOfficeId = extractCompanyOfficeId(req);
    const ownerQuery = buildOwnerQuery(req.user || {});
    const baseQuery = isMongoId
      ? { $or: [{ report_id: reportId }, { _id: reportId }] }
      : { report_id: reportId };
    const query = { ...baseQuery };
    if (companyOfficeId) query.company_office_id = companyOfficeId;
    if (Object.keys(ownerQuery).length) {
      query.$and = query.$and ? [...query.$and, ownerQuery] : [ownerQuery];
    }

    const report = await UrgentReport.findOne(query).lean();
    if (!report) {
      return res
        .status(404)
        .json({ status: "failed", error: "Report not found" });
    }

    return res.json({ status: "success", report });
  } catch (err) {
    console.error("Get report by ID error:", err);
    return res.status(500).json({
      status: "failed",
      error: err.message || "Failed to fetch report",
    });
  }
};
