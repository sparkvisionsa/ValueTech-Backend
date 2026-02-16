const mongoose = require("mongoose");

const reportDeletionSchema = new mongoose.Schema(
  {
    // ------------------------------------------------------------------
    // RELATIONS
    // ------------------------------------------------------------------
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      default: null,
    },

    company_office_id: {
      type: String,
      default: null,
      index: true,
    },

    taqeem_user: {
      type: String,
      default: null,
      index: true,
    },

    // ------------------------------------------------------------------
    // REPORT IDENTIFICATION
    // ------------------------------------------------------------------
    report_id: {
      type: String,
      required: true,
      index: true,
    },

    // ------------------------------------------------------------------
    // ACTION / TYPE
    // ------------------------------------------------------------------
    action: {
      type: String,
      enum: [
        "validate",
        "delete-report",
        "delete-assets",
        "status-check",
        "cancel-report",
      ],
      default: null,
      index: true,
    },

    delete_type: {
      type: String,
      enum: ["report", "assets", null],
      default: null,
      index: true,
    },

    // ------------------------------------------------------------------
    // RESULTS / ERRORS
    // ------------------------------------------------------------------
    result: {
      type: String,
      default: null,
    },

    error: {
      type: String,
      default: null,
    },

    validation_message: {
      type: String,
      default: null,
    },

    // ------------------------------------------------------------------
    // STATUS DATA
    // ------------------------------------------------------------------
    report_status: {
      type: String,
      default: null,
      index: true,
    },

    report_status_label: {
      type: String,
      default: null,
    },

    last_status_check_status: {
      type: String,
      default: null,
    },

    last_status_check_at: {
      type: Date,
      default: null,
      index: true,
    },

    // ------------------------------------------------------------------
    // ASSET COUNTS
    // ------------------------------------------------------------------
    total_assets: {
      type: Number,
      default: 0,
    },

    remaining_assets: {
      type: Number,
      default: 0,
    },

    assets_exact: {
      type: Number,
      default: 0,
    },

    micros_count: {
      type: Number,
      default: 0,
    },

    // ------------------------------------------------------------------
    // FLAGS
    // ------------------------------------------------------------------
    deleted: {
      type: Boolean,
      default: false,
      index: true,
    },

    deleted_at: {
      type: Date,
      default: null,
    },

    checked: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: {
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
);

// ----------------------------------------------------------------------
// INDEXES
// ----------------------------------------------------------------------
reportDeletionSchema.index({ user_id: 1, report_id: 1 });
reportDeletionSchema.index({ user_id: 1, deleted: 1 });
reportDeletionSchema.index({ report_id: 1, last_status_check_at: -1 });
reportDeletionSchema.index({ user_id: 1, company_office_id: 1 });

// ----------------------------------------------------------------------
// IMPORTANT PART — COLLECTION NAME
// ----------------------------------------------------------------------
module.exports = mongoose.model(
  "ReportDeletion", // Model Name
  reportDeletionSchema,
  "report_deletions", // EXACT Mongo Collection Name
);
