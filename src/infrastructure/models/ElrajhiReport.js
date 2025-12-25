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

    client_name: {
      type: String,
      required: true, // client_name (id) asset_name
      minlength: [9, "client_name must be at least 9 characters"],
      trim: true,
      validate: {
        validator: function (v) {
          return typeof v === "string" && v.trim().length >= 9;
        },
        message: "client_name must be a non-empty string with at least 9 characters",
      },
    },

    purpose_id: {
      type: Number,
      required: true,
      validate: {
        validator: function (v) {
          return typeof v === "number" && Number.isFinite(v);
        },
        message: "purpose_id must be a valid number",
      },
    },

    value_premise_id: {
      type: Number,
      required: true,
      validate: {
        validator: function (v) {
          return typeof v === "number" && Number.isFinite(v);
        },
        message: "value_premise_id must be a valid number",
      },
    },

    report_type: { type: String },

    valued_at: {
      type: Date,
      required: true,
    },

    submitted_at: {
      type: Date,
      required: true,
      validate: {
        validator: function (v) {
          // Date of Valuation must be on or before Report Issuing Date
          if (!v || !this.valued_at) return true; // required handles missing
          return this.valued_at.getTime() <= v.getTime();
        },
        message: "Date of Valuation must be on or before Report Issuing Date",
      },
    },

    inspection_date: {
      type: Date,
      required: true,
    },

    owner_name: {
      type: String,
      required: true,
      trim: true,
      validate: {
        validator: function (v) {
          return typeof v === "string" && v.trim().length > 0;
        },
        message: "owner_name is required",
      },
    },

    assumptions: { type: String },
    special_assumptions: { type: String },

    telephone: {
      type: String,
      required: true,
      minlength: [8, "telephone must be at least 8 characters"],
      trim: true,
      validate: {
        validator: function (v) {
          return typeof v === "string" && v.trim().length >= 8;
        },
        message: "telephone is required and must be at least 8 characters",
      },
    },

    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      validate: {
        validator: function (v) {
          if (typeof v !== "string") return false;
          const s = v.trim();
          if (!s) return false;
          // simple email validation
          return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
        },
        message: "email is required and must be a valid email address",
      },
    },

    region: {
      type: String,
      required: true,
      trim: true,
      validate: {
        validator: function (v) {
          return typeof v === "string" && v.trim().length > 0;
        },
        message: "region is required",
      },
    },

    city: {
      type: String,
      required: true,
      trim: true,
      validate: {
        validator: function (v) {
          return typeof v === "string" && v.trim().length > 0;
        },
        message: "city is required",
      },
    },

    // Per-asset fields derived from market
    value: {
      type: Number,
      default: 0, // from market.final_value
      required: true,
      validate: [
        {
          validator: function (v) {
            return typeof v === "number" && Number.isFinite(v);
          },
          message: "value must be a valid number",
        },
        {
          validator: function (v) {
            // required, non-zero, not negative
            return v > 0;
          },
          message: "value must be greater than 0",
        },
      ],
    },

    asset_id: { type: Number }, // id from market or index+1

    asset_name: {
      type: String,
      required: true,
      trim: true,
      validate: {
        validator: function (v) {
          return typeof v === "string" && v.trim().length > 0;
        },
        message: "asset_name is required",
      },
    },

    asset_usage: {
      type: String,
      required: true,
      trim: true,
      validate: {
        validator: function (v) {
          return typeof v === "string" && v.trim().length > 0;
        },
        message: "asset_usage is required",
      },
    },

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
