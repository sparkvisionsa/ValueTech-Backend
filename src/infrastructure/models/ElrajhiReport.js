// src/infrastructure/models/ElrajhiReport.js
const mongoose = require("mongoose");

const ValuerSchema = new mongoose.Schema(
  {
    valuerId: { type: String },
    valuerName: { type: String },
    percentage: { type: Number, required: true },
  },
  { _id: false }
);

const ElrajhiReportSchema = new mongoose.Schema(
  {
    batchId: {
      type: String,
      required: true,
      index: true,
    },
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    user_phone: { type: String },
    company: { type: mongoose.Schema.Types.ObjectId, ref: "Company", default: null },

    // Report Info (flattened, per report/asset)
    title: { type: String },
    client_name: { type: String, required: true }, // client_name (id) asset_name
    purpose_id: { type: Number },
    value_premise_id: { type: Number },
    report_type: { type: String },

    valued_at: { type: Date },
    submitted_at: { type: Date },
    inspection_date: { type: Date },
    owner_name: { type: String },

    assumptions: { type: String },
    special_assumptions: { type: String },

    telephone: { type: String },
    email: { type: String },

    region: { type: String },
    city: { type: String },

    // Per-asset fields derived from market
    value: { type: Number, default: 0 },  // from market.final_value
    asset_id: { type: Number },           // id from market or index+1
    asset_name: { type: String },
    asset_usage: { type: String },

    // Full market row for debugging / extra data
    asset: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },

    // Structured valuers array
    valuers: {
      type: [ValuerSchema],
      default: [],
    },

    // PDF path (real or temp)
    pdf_path: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ElrajhiReport", ElrajhiReportSchema);
