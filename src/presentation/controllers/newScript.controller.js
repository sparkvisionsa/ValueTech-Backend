const ElrajhiReport = require("../../infrastructure/models/ElrajhiReport");
const MultiApproachReport = require("../../infrastructure/models/MultiApproachReport");
const UrgentReport = require("../../infrastructure/models/UrgentReport");
const Report = require("../../infrastructure/models/report");
const DuplicateReport = require("../../infrastructure/models/DuplicateReport");
const SubmitReportsQuickly = require("../../infrastructure/models/SubmitReportsQuickly");
const ReportDeletion = require("../../infrastructure/models/ReportDeletions");

const mongoose = require("mongoose");

const BATCH_FIELD_MAP = {
  MultiApproachReport: "batchId",
  default: "batch_id",
};

const BATCH_COLLECTIONS = {
  DuplicateReport,
  ElrajhiReport,
  MultiApproachReport,
  UrgentReport,
  SubmitReportsQuickly,
};

function getBatchField(collectionName) {
  return BATCH_FIELD_MAP[collectionName] || BATCH_FIELD_MAP.default;
}

const ALL_COLLECTIONS = {
  DuplicateReport,
  ElrajhiReport,
  MultiApproachReport,
  UrgentReport,
  SubmitReportsQuickly,
  Report,
};

async function findReportAcrossCollections(report_id) {
  for (const [collection, Model] of Object.entries(ALL_COLLECTIONS)) {
    const doc = await Model.findOne({ report_id });
    if (doc) {
      return { doc, model: Model, collection };
    }
  }
  return null;
}

async function findReportAcrossCollectionsWithId(record_id) {
  // check if its an object id first, if not, convert it
  if (!mongoose.Types.ObjectId.isValid(record_id)) {
    record_id = new mongoose.Types.ObjectId(record_id);
  }
  for (const [collection, Model] of Object.entries(ALL_COLLECTIONS)) {
    const doc = await Model.findOne({ _id: record_id });
    if (doc) {
      return { doc, model: Model, collection };
    }
  }
  return null;
}

async function updateReportsByBatchId(batch_id, update) {
  let totalMatched = 0;
  let totalModified = 0;

  for (const [name, Model] of Object.entries(BATCH_COLLECTIONS)) {
    const batchField = getBatchField(name);
    const result = await Model.updateMany(
      { [batchField]: batch_id },
      { $set: update },
    );

    totalMatched += result.matchedCount;
    totalModified += result.modifiedCount;
  }

  return { totalMatched, totalModified };
}

exports.getReportsByBatchId = async (req, res) => {
  try {
    const { batch_id } = req.params;
    if (!batch_id) {
      return res.status(400).json({
        success: false,
        message: "batch_id is required",
      });
    }

    // Search all collections but return as soon as we find the batch
    for (const [name, Model] of Object.entries(BATCH_COLLECTIONS)) {
      const batchField = getBatchField(name);
      const docs = await Model.find({ [batchField]: batch_id }).lean();
      if (docs.length > 0) {
        return res.json({
          success: true,
          batch_id,
          collection: name,
          total: docs.length,
          reports: docs, // Flat array of report documents
        });
      }
    }

    // No reports found in any collection
    return res.status(404).json({
      success: false,
      message: `No reports found for batch_id: ${batch_id}`,
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

exports.setFlowStartTime = async (req, res) => {
  const { report_id } = req.params;

  const found = await findReportAcrossCollections(report_id);
  if (!found) {
    return res.status(404).json({ success: false });
  }

  const result = await found.model.updateOne(
    { _id: found.doc._id },
    { $set: { flowStartTime: Date.now() } },
  );

  res.json({
    success: true,
    matched: result.matchedCount,
  });
};

exports.setFlowStartTimeWithId = async (req, res) => {
  const { record_id } = req.params;

  const found = await findReportAcrossCollectionsWithId(record_id);
  if (!found) {
    return res.status(404).json({ success: false });
  }

  const result = await found.model.updateOne(
    { _id: found.doc._id },
    { $set: { flowStartTime: Date.now() } },
  );

  res.json({
    success: true,
    matched: result.matchedCount,
  });
};
exports.updateMultipleMacros = async (req, res) => {
  try {
    const { report_id } = req.params;
    const { macro_updates } = req.body; // Array of {macro_id, submitState}

    const found = await findReportAcrossCollections(report_id);
    if (!found) {
      return res.status(404).json({ success: false });
    }

    let totalModified = 0;

    for (const { macro_id, submitState } of macro_updates) {
      const result = await found.model.updateOne(
        { _id: found.doc._id, "asset_data.id": String(macro_id) },
        { $set: { "asset_data.$.submitState": submitState } },
      );
      totalModified += result.modifiedCount;
    }

    res.json({
      success: true,
      modified: totalModified,
    });
  } catch (err) {
    console.error("updateMultipleMacros:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.updateReportPgCount = async (req, res) => {
  try {
    const { report_id } = req.params;
    const { pg_count } = req.body;

    if (!pg_count || isNaN(pg_count)) {
      return res.status(400).json({
        success: false,
        message: "pg_count is required and must be a number",
      });
    }

    const found = await findReportAcrossCollections(report_id);
    if (!found) {
      return res.status(404).json({
        success: false,
        message: "Report not found",
      });
    }

    const result = await found.model.updateOne(
      { _id: found.doc._id },
      { $set: { pg_count: parseInt(pg_count), updatedAt: new Date() } },
    );

    res.json({
      success: true,
      collection: found.collection,
      matched: result.matchedCount,
      modified: result.modifiedCount,
      pg_count: parseInt(pg_count),
    });
  } catch (err) {
    console.error("updateReportPgCount:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.updateAssetsByIndex = async (req, res) => {
  try {
    const { record_id } = req.params;
    const { updates } = req.body; // Array of {index, submitState}

    const found = await findReportAcrossCollectionsWithId(record_id);
    if (!found) {
      return res.status(404).json({ success: false });
    }

    const updateObj = {};
    updates.forEach(({ index, submitState }) => {
      updateObj[`asset_data.${index}.submitState`] = submitState;
    });

    const result = await found.model.updateOne(
      { _id: found.doc._id },
      { $set: updateObj },
    );

    res.json({
      success: true,
      matched: result.matchedCount,
      modified: result.modifiedCount,
    });
  } catch (err) {
    console.error("updateAssetsByIndex:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.setFlowEndTime = async (req, res) => {
  const { report_id } = req.params;

  const found = await findReportAcrossCollections(report_id);
  if (!found) {
    return res.status(404).json({ success: false });
  }

  const result = await found.model.updateOne(
    { _id: found.doc._id },
    { $set: { flowEndTime: Date.now() } },
  );

  res.json({
    success: true,
    matched: result.matchedCount,
  });
};

exports.setReportId = async (req, res) => {
  const { record_id } = req.params;
  const { report_id } = req.body;
  const { macro_count } = req.body;

  const found = await findReportAcrossCollectionsWithId(record_id);
  if (!found) {
    return res.status(404).json({ success: false });
  }
  let result;
  if (macro_count) {
    result = await found.model.updateOne(
      { _id: found.doc._id },
      { $set: { report_id: report_id, macro_count: macro_count } },
    );
  } else {
    result = await found.model.updateOne(
      { _id: found.doc._id },
      { $set: { report_id: report_id } },
    );
  }

  res.json({
    success: true,
    matched: result.matchedCount,
  });
};

exports.setFlowEndTimeWithId = async (req, res) => {
  const { record_id } = req.params;

  const found = await findReportAcrossCollectionsWithId(record_id);
  if (!found) {
    return res.status(404).json({ success: false });
  }

  const result = await found.model.updateOne(
    { _id: found.doc._id },
    { $set: { flowEndTime: Date.now() } },
  );

  res.json({
    success: true,
    matched: result.matchedCount,
  });
};

exports.updateMacroSubmitState = async (req, res) => {
  const { report_id, macro_id } = req.params;
  const { submitState } = req.body;

  const found = await findReportAcrossCollections(report_id);
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

  const found = await findReportAcrossCollections(report_id);
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

  const found = await findReportAcrossCollections(report_id);
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

exports.updateReportStatusWithId = async (req, res) => {
  const { record_id } = req.params;
  const { report_status } = req.body;

  if (!report_status) {
    return res.status(400).json({ success: false });
  }

  const found = await findReportAcrossCollectionsWithId(record_id);
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

exports.updateElrajhiStatus = async (req, res) => {
  const { record_id } = req.params;
  const { report_status, submit_state } = req.body;

  const found = await findReportAcrossCollectionsWithId(record_id);
  if (!found) {
    return res.status(404).json({ success: false });
  }

  await found.model.updateOne(
    { _id: found.doc._id },
    { $set: { report_status, submit_state, last_checked_at: Date.now() } },
  );

  res.json({
    success: true,
    collection: found.collection,
    report_status,
    submit_state,
  });
};

exports.getLatestDuplicateReport = async (req, res) => {
  try {
    // Only check DuplicateReport collection for latest
    const doc = await DuplicateReport.findOne().sort({ createdAt: -1 }).lean();

    if (doc) {
      return res.json({
        success: true,
        collection: "DuplicateReport",
        data: doc,
      });
    }

    return res.status(404).json({
      success: false,
      message: "No duplicate reports found",
    });
  } catch (err) {
    console.error("getLatestDuplicateReport:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.recomputeReportStatus = async (req, res) => {
  const { report_id } = req.params;

  const found = await findReportAcrossCollections(report_id);
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
    for (const [name, model] of Object.entries(ALL_COLLECTIONS)) {
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

exports.updateStartTimeByBatchId = async (req, res) => {
  const { batch_id } = req.params;

  if (!batch_id) {
    return res.status(400).json({ success: false });
  }

  try {
    const result = await updateReportsByBatchId(batch_id, {
      startSubmitTime: Date.now(),
    });

    return res.json({
      success: true,
      matched: result.totalMatched,
      modified: result.totalModified,
    });
  } catch (err) {
    console.error("updateStartTimeByBatchId:", err);
    return res.status(500).json({ success: false });
  }
};

exports.getReportsBulk = async (req, res) => {
  try {
    const { record_ids } = req.body;

    if (!Array.isArray(record_ids) || record_ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: "record_ids[] is required",
      });
    }

    // Convert to ObjectIds
    const objectIds = record_ids
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    if (objectIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid ObjectIds provided",
      });
    }

    // 1. Find which collection contains the first id
    let targetModel = null;
    let collectionName = null;

    for (const [name, Model] of Object.entries(ALL_COLLECTIONS)) {
      const exists = await Model.exists({ _id: objectIds[0] });
      if (exists) {
        targetModel = Model;
        collectionName = name;
        break;
      }
    }

    if (!targetModel) {
      return res.status(404).json({
        success: false,
        message: "Reports not found in any collection",
      });
    }

    // 2. Fetch all reports from that collection
    const docs = await targetModel.find({ _id: { $in: objectIds } }).lean();

    return res.json({
      success: true,
      collection: collectionName,
      total: docs.length,
      reports: docs,
    });
  } catch (err) {
    console.error("getReportsBulk:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

exports.getReportsBulkByReportId = async (req, res) => {
  try {
    const { report_ids } = req.body;

    if (!Array.isArray(report_ids) || report_ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: "report_ids[] is required",
      });
    }

    // 1. Detect which collection contains the first report_id
    let targetModel = null;
    let collectionName = null;

    for (const [name, Model] of Object.entries(ALL_COLLECTIONS)) {
      const exists = await Model.exists({ report_id: report_ids[0] });
      if (exists) {
        targetModel = Model;
        collectionName = name;
        break;
      }
    }

    if (!targetModel) {
      return res.status(404).json({
        success: false,
        message: "Reports not found in any collection",
      });
    }

    // 2. Fetch all reports from that collection
    const docs = await targetModel
      .find({
        report_id: { $in: report_ids },
      })
      .lean();

    return res.json({
      success: true,
      collection: collectionName,
      total: docs.length,
      reports: docs,
    });
  } catch (err) {
    console.error("getReportsBulkByReportId:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};
exports.updateReportTimestamp = async (req, res) => {
  try {
    const { record_id } = req.params;
    const { type } = req.body;

    if (!type) {
      return res.status(400).json({
        success: false,
        message: "type is required",
      });
    }

    const found = await findReportAcrossCollectionsWithId(record_id);
    if (!found) {
      return res.status(404).json({
        success: false,
        message: "Report not found",
      });
    }

    const result = await found.model.updateOne(
      { _id: found.doc._id },
      { $set: { [type]: Date.now() } },
    );

    res.json({
      success: true,
      matched: result.matchedCount,
      modified: result.modifiedCount,
      type,
      timestamp: Date.now(),
    });
  } catch (err) {
    console.error("updateReportTimestamp:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.resolveCompanyOfficeId = async (req, res) => {
  try {
    const { report_id } = req.params;

    if (!report_id) {
      return res.status(400).json({
        success: false,
        message: "report_id is required",
      });
    }

    for (const [name, Model] of Object.entries(ALL_COLLECTIONS)) {
      const doc = await Model.findOne(
        {
          report_id: String(report_id),
          company_office_id: { $exists: true, $nin: [null, ""] },
        },
        { company_office_id: 1 },
      ).lean();

      if (doc && doc.company_office_id) {
        return res.json({
          success: true,
          collection: name,
          company_office_id: String(doc.company_office_id),
        });
      }
    }

    return res.status(404).json({
      success: false,
      message: "company_office_id not found for this report_id",
    });
  } catch (err) {
    console.error("resolveCompanyOfficeId:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

exports.updateReportCheckStatus = async (req, res) => {
  try {
    const { report_id, user_id, company_office_id, updates } = req.body;

    if (!report_id || !updates || typeof updates !== "object") {
      return res.status(400).json({
        success: false,
        message: "report_id and updates object are required",
      });
    }

    console.log("updates:", updates);

    const payload = {
      report_id: String(report_id),
      user_id: user_id ? String(user_id) : null,
      ...updates,
    };

    if (company_office_id) {
      payload.company_office_id = String(company_office_id);
    }

    const query = {
      report_id: String(report_id),
      user_id: user_id ? String(user_id) : null,
    };

    if (company_office_id) {
      query.company_office_id = String(company_office_id);
    }

    const result = await ReportDeletion.updateOne(
      query,
      { $set: payload },
      { upsert: true },
    );

    return res.json({
      success: true,
      matched: result.matchedCount,
      modified: result.modifiedCount,
      upsertedId: result.upsertedId || null,
    });
  } catch (err) {
    console.error("updateReportCheckStatus:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};
