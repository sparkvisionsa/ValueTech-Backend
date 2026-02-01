// controllers/report.controller.jsconst DuplicateReport = require("../models/DuplicateReport");
const ElrajhiReport = require("../../infrastructure/models/ElrajhiReport");
const MultiApproachReport = require("../../infrastructure/models/MultiApproachReport");
const UrgentReport = require("../../infrastructure/models/UrgentReport");
const Report = require("../../infrastructure/models/report");
const DuplicateReport = require("../../infrastructure/models/DuplicateReport");

const mongoose = require("mongoose");

const BATCH_COLLECTIONS = {
  DuplicateReport,
  ElrajhiReport,
  MultiApproachReport,
  UrgentReport,
};

const ALL_COLLECTIONS = {
  DuplicateReport,
  ElrajhiReport,
  MultiApproachReport,
  UrgentReport,
  Report,
};

exports.getReportsByBatchId = async (req, res) => {
  try {
    const { batch_id } = req.params;

    if (!batch_id) {
      return res.status(400).json({
        success: false,
        message: "batch_id is required",
      });
    }

    const queries = Object.entries(BATCH_COLLECTIONS).map(
      async ([name, Model]) => {
        const docs = await Model.find({ batch_id }).lean();
        return docs.length ? { collection: name, data: docs } : null;
      },
    );

    const results = (await Promise.all(queries)).filter(Boolean);

    return res.json({
      success: true,
      batch_id,
      total: results.reduce((sum, r) => sum + r.data.length, 0),
      results,
    });
  } catch (err) {
    console.error("getReportsByBatchId:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.findReportByReportId = async (req, res) => {
  try {
    const { report_id } = req.params;

    if (!report_id) {
      return res.status(400).json({
        success: false,
        message: "report_id is required",
      });
    }

    for (const [name, Model] of Object.entries(ALL_COLLECTIONS)) {
      const doc = await Model.findOne({ report_id }).lean();
      if (doc) {
        return res.json({
          success: true,
          collection: name,
          data: doc,
        });
      }
    }

    return res.status(404).json({
      success: false,
      message: "Report not found",
    });
  } catch (err) {
    console.error("findReportByReportId:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.findReportById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid _id",
      });
    }

    for (const [name, Model] of Object.entries(ALL_COLLECTIONS)) {
      const doc = await Model.findById(id).lean();
      if (doc) {
        return res.json({
          success: true,
          collection: name,
          data: doc,
        });
      }
    }

    return res.status(404).json({
      success: false,
      message: "Report not found",
    });
  } catch (err) {
    console.error("findReportById:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.updateMacroSubmitState = async (req, res) => {
  const { report_id, macro_id } = req.params;
  const { submitState } = req.body;

  const found = await reportService.findReportByReportId(report_id);
  if (!found) {
    return res.status(404).json({ success: false });
  }

  const result = await found.model.updateOne(
    { _id: found.doc._id, "asset_data.id": String(macro_id) },
    { $set: { "asset_data.$.submitState": submitState } },
  );

  res.json({
    success: true,
    matched: result.matchedCount,
  });
};

exports.markAllMacrosComplete = async (req, res) => {
  const { report_id } = req.params;

  const found = await reportService.findReportByReportId(report_id);
  if (!found) {
    return res.status(404).json({ success: false });
  }

  const updates = {};
  found.doc.asset_data.forEach((_, i) => {
    updates[`asset_data.${i}.submitState`] = 1;
  });

  await found.model.updateOne({ _id: found.doc._id }, { $set: updates });

  res.json({ success: true });
};

exports.updateReportStatus = async (req, res) => {
  const { report_id } = req.params;
  const { report_status } = req.body;

  if (!report_status) {
    return res.status(400).json({ success: false });
  }

  const found = await reportService.findReportByReportId(report_id);
  if (!found) {
    return res.status(404).json({ success: false });
  }

  await found.model.updateOne(
    { _id: found.doc._id },
    { $set: { report_status } },
  );

  res.json({
    success: true,
    collection: found.collection,
    report_status,
  });
};

exports.recomputeReportStatus = async (req, res) => {
  const { report_id } = req.params;

  const found = await reportService.findReportByReportId(report_id);
  if (!found) {
    return res.status(404).json({ success: false });
  }

  const assets = found.doc.asset_data || [];
  const hasIncomplete = assets.some((a) => String(a.submitState) !== "1");

  let newStatus = hasIncomplete ? "INCOMPLETE" : "COMPLETE";

  if (["SENT", "CONFIRMED"].includes(found.doc.report_status)) {
    newStatus = found.doc.report_status;
  }

  await found.model.updateOne(
    { _id: found.doc._id },
    { $set: { report_status: newStatus } },
  );

  res.json({ success: true, report_status: newStatus });
};

exports.updateReportWithMacroIds = async (req, res) => {
  try {
    const { report_id } = req.params;
    const { macro_ids_with_pages } = req.body;

    if (!report_id || !Array.isArray(macro_ids_with_pages)) {
      return res.status(400).json({
        success: false,
        message: "report_id and macro_ids_with_pages[] are required",
      });
    }

    let foundReport = null;
    let targetModel = null;
    let collectionName = null;

    // 1. Find report across collections
    for (const { name, model } of COLLECTIONS) {
      const doc = await model.findOne({ report_id }).lean();
      if (doc) {
        foundReport = doc;
        targetModel = model;
        collectionName = name;
        break;
      }
    }

    if (!foundReport) {
      return res.status(404).json({
        success: false,
        message: `Report ${report_id} not found in any collection`,
      });
    }

    const existingAssets = foundReport.asset_data || [];

    if (!existingAssets.length) {
      return res.status(400).json({
        success: false,
        message: "No asset_data found in report",
      });
    }

    // 2. Update assets (order-sensitive)
    const updatedAssets = [];

    for (
      let i = 0;
      i < Math.min(existingAssets.length, macro_ids_with_pages.length);
      i++
    ) {
      const asset = existingAssets[i];
      const [macroId, pageNum] = macro_ids_with_pages[i];

      updatedAssets.push({
        ...asset,
        id: String(macroId),
        pg_no: String(pageNum),
      });
    }

    // 3. Keep remaining assets unchanged
    if (existingAssets.length > macro_ids_with_pages.length) {
      updatedAssets.push(...existingAssets.slice(macro_ids_with_pages.length));
    }

    // 4. Update DB
    const result = await targetModel.updateOne(
      { report_id },
      {
        $set: {
          asset_data: updatedAssets,
          updatedAt: new Date(),
        },
      },
    );

    return res.json({
      success: true,
      collection: collectionName,
      matched: result.matchedCount,
      modified: result.modifiedCount,
    });
  } catch (err) {
    console.error("updateReportWithMacroIds:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
