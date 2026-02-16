const mongoose = require("mongoose");
const ReportDeletion = require("../../infrastructure/models/ReportDeletions"); // <-- adjust path

// ============================================================================
// VALIDATE REPORT
// ============================================================================
exports.validateReport = async (req, res) => {
  try {
    const { reportId } = req.params;
    const userId = req.user?.id || req.user?._id;
    const companyOfficeId =
      req.body.companyOfficeId || req.query.companyOfficeId;

    if (!userId) {
      return res.status(401).json({
        status: "FAILED",
        error: "Unauthorized",
      });
    }

    if (!reportId) {
      return res.status(400).json({
        status: "FAILED",
        error: "Report ID is required",
      });
    }

    // TODO: Replace with real API logic
    const validationResult = {
      status: "SUCCESS",
      reportId,
      reportStatus: "Draft",
      assetsExact: 0,
      microsCount: 0,
      message: "Validation completed",
    };

    await ReportDeletion.updateOne(
      {
        report_id: String(reportId),
        user_id: userId,
      },
      {
        $set: {
          company_office_id: companyOfficeId || null,
          report_status: validationResult.reportStatus,
          assets_exact:
            validationResult.assetsExact || validationResult.microsCount || 0,
          last_status_check_status: validationResult.status,
          last_status_check_at: new Date(),
          action: "validate",
          checked: true,
        },
      },
      { upsert: true },
    );

    return res.json(validationResult);
  } catch (error) {
    console.error("Validate report error:", error.stack);
    return res.status(500).json({
      status: "FAILED",
      error: error.message || "Validation failed",
    });
  }
};

// ============================================================================
// GET REPORT DELETIONS
// ============================================================================
exports.getReportDeletions = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;

    if (!userId) {
      return res.status(401).json({
        status: "FAILED",
        error: "Unauthorized",
      });
    }

    const {
      deleteType,
      page = 1,
      limit = 10,
      searchTerm,
      companyOfficeId,
    } = req.query;

    const query = {
      user_id: userId,
      deleted: true,
    };

    if (companyOfficeId) query.company_office_id = companyOfficeId;
    if (deleteType) query.delete_type = deleteType;
    if (searchTerm) query.report_id = { $regex: searchTerm, $options: "i" };

    const skip = Math.max(Number(page) - 1, 0) * Number(limit);

    const [total, docs] = await Promise.all([
      ReportDeletion.countDocuments(query),
      ReportDeletion.find(query)
        .sort({ updated_at: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
    ]);

    const items = docs.map((d) => ({
      report_id: d.report_id,
      delete_type: d.delete_type,
      deleted: d.deleted,
      remaining_assets: d.remaining_assets,
      total_assets: d.total_assets,
      result: d.result,
      report_status: d.report_status,
      updated_at: d.updated_at,
      deleted_at: d.deleted_at,
    }));

    return res.json({
      status: "SUCCESS",
      items,
      total,
      page: Number(page),
      limit: Number(limit),
    });
  } catch (error) {
    console.error("Get report deletions error:", error.stack);
    return res.status(500).json({
      status: "FAILED",
      error: error.message,
    });
  }
};

// ============================================================================
// STORE REPORT DELETION
// ============================================================================
exports.storeReportDeletion = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;

    if (!userId) {
      return res.status(401).json({
        status: "FAILED",
        error: "Unauthorized",
      });
    }

    const {
      reportId,
      action,
      result,
      reportStatus,
      totalAssets,
      error: deletionError,
      companyOfficeId,
    } = req.body;

    if (!reportId || !action) {
      return res.status(400).json({
        status: "FAILED",
        error: "reportId and action are required",
      });
    }

    const isDeleted =
      result === "Report - Deleted" || result === "Asset - Deleted";

    await ReportDeletion.create({
      user_id: userId,
      report_id: String(reportId),
      action,
      result,
      report_status: reportStatus || null,
      total_assets: totalAssets || 0,
      deleted: isDeleted,
      delete_type:
        action === "delete-report"
          ? "report"
          : action === "delete-assets"
            ? "assets"
            : null,
      deleted_at: isDeleted ? new Date() : null,
      company_office_id: companyOfficeId || null,
      error: deletionError || null,
    });

    return res.json({
      status: "SUCCESS",
      message: "Deletion record stored",
    });
  } catch (error) {
    console.error("Store report deletion error:", error.stack);
    return res.status(500).json({
      status: "FAILED",
      error: error.message,
    });
  }
};

// ============================================================================
// GET CHECKED REPORTS
// ============================================================================
exports.getCheckedReports = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;

    if (!userId) {
      return res.status(401).json({
        status: "FAILED",
        error: "Unauthorized",
      });
    }

    const { page = 1, limit = 10, searchTerm, companyOfficeId } = req.query;

    const query = { user_id: userId };

    if (companyOfficeId) query.company_office_id = companyOfficeId;
    if (searchTerm) query.report_id = { $regex: searchTerm, $options: "i" };

    const skip = Math.max(Number(page) - 1, 0) * Number(limit);

    const [total, docs] = await Promise.all([
      ReportDeletion.countDocuments(query),
      ReportDeletion.find(query)
        .sort({ last_status_check_at: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
    ]);

    const items = docs.map((d) => ({
      report_id: d.report_id,
      report_status: d.report_status,
      report_status_label: d.report_status_label,
      assets_exact: d.assets_exact,
      last_status_check_status: d.last_status_check_status,
      last_status_check_at: d.last_status_check_at,
    }));

    return res.json({
      status: "SUCCESS",
      items,
      total,
      page: Number(page),
      limit: Number(limit),
    });
  } catch (error) {
    console.error("Get checked reports error:", error.stack);
    return res.status(500).json({
      status: "FAILED",
      error: error.message,
    });
  }
};

// ============================================================================
// GET VALIDATION RESULTS
// ============================================================================
exports.getValidationResults = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    const { reportIds } = req.body;

    if (!userId || !Array.isArray(reportIds)) {
      return res.status(400).json({
        status: "FAILED",
        error: "reportIds array is required",
      });
    }

    const docs = await ReportDeletion.find({
      user_id: userId,
      report_id: { $in: reportIds.map(String) },
    })
      .sort({ updated_at: -1 })
      .lean();

    const validationResults = {};

    for (const d of docs) {
      if (d.report_id && !validationResults[d.report_id]) {
        validationResults[d.report_id] = {
          report_id: d.report_id,
          result: d.result,
          report_status: d.report_status,
          total_assets: d.total_assets || 0,
        };
      }
    }

    return res.json({
      status: "SUCCESS",
      items: Object.values(validationResults),
    });
  } catch (error) {
    console.error("Get validation results error:", error.stack);
    return res.status(500).json({
      status: "FAILED",
      error: error.message,
    });
  }
};

// ============================================================================
// HANDLE CANCELLED REPORT
// ============================================================================
exports.handleCancelledReport = async (req, res) => {
  try {
    const { reportId } = req.params;

    if (!reportId) {
      return res.status(400).json({
        status: "FAILED",
        error: "Report ID is required",
      });
    }

    // TODO: integrate real API status change

    return res.json({
      status: "SUCCESS",
      message: "Report status changed successfully",
      reportId,
    });
  } catch (error) {
    console.error("Handle cancelled report error:", error.stack);
    return res.status(500).json({
      status: "FAILED",
      error: error.message,
    });
  }
};
