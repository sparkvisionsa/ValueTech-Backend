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

    report_status: String,

    assets_exact: {
      type: Number,
      default: 0,
    },

    last_status_check_status: String,
    last_status_check_source: String,
    report_status_label: String,

    deleted: {
      type: Boolean,
      default: false,
    },

    remaining_assets: {
      type: Number,
      default: 0,
    },

    company_office_id: String,

    total_assets: {
      type: Number,
      default: 0,
    },

    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },

    deleted_at: Date,
  },
  {
    collection: "report_deletions",
    timestamps: {
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
);

module.exports = mongoose.model("ReportDeletion", ReportDeletionSchema);
