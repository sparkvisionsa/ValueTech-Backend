const mongoose = require("mongoose");

const ReportDeletionSchema = new mongoose.Schema(
  {
    delete_type: {
      type: String,
      required: true,
    },

    report_id: {
      type: String,
      required: true,
      index: true,
    },

    report_status: {
      type: String,
    },

    assets_exact: {
      type: Number,
      default: 0,
    },

    last_status_check_status: {
      type: String,
    },

    last_status_check_source: {
      type: String,
    },

    report_status_label: {
      type: String,
    },

    deleted: {
      type: Boolean,
      default: false,
    },

    remaining_assets: {
      type: Number,
      default: 0,
    },
    company_office_id: {
      type: String,
    },

    total_assets: {
      type: Number,
      default: 0,
    },

    user_id: {
      type: mongoose.Schema.Types.ObjectId, // or String if needed
      required: true,
    },

    deleted_at: Date,
    updated_at: Date,
  },
  {
    collection: "report_deletions", // <-- EXACT NAME FROM ATLAS
    timestamps: false,
  },
);

module.exports = mongoose.model("ReportDeletion", ReportDeletionSchema);
