const e = require('express');
const mongoose = require('mongoose');

function toYMD(value) {
  if (!value) return value;

  // If it's already "yyyy-mm-dd", keep it
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return value;

    // Already correct
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

    // If ISO string "yyyy-mm-ddT...." -> take first 10 chars
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10);

    // Support "dd/mm/yyyy" or "dd-mm-yyyy"
    const parts = s.split(/[\/\-]/);
    if (parts.length === 3 && parts[0].length <= 2) {
      const dNum = parseInt(parts[0], 10);
      const mNum = parseInt(parts[1], 10);
      const yNum = parseInt(parts[2], 10);
      if (dNum && mNum && yNum) {
        const dt = new Date(Date.UTC(yNum, mNum - 1, dNum));
        if (!isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
      }
    }

    // Fallback: try parseable date strings
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);

    return value;
  }

  // Date object
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return value;
    return value.toISOString().slice(0, 10);
  }

  // timestamp number
  if (typeof value === "number") {
    const d = new Date(value);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }

  return value;
}


const urgentSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  user_phone: { type: String },
  taqeem_user: { type: String, default: null, index: true },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', default: null },
  company_office_id: { type: String, default: null, index: true },
  report_id: { type: String },
  source_excel_name: { type: String },
  title: String,
  batch_id: String,

  client_name: {
    type: String,
    required: [true, "client_name is required"],
    minlength: [9, "client_name must be at least 9 characters"],
    trim: true,
  },

  purpose_id: {
    type: Number,
    required: [true, "purpose_id is required"],
  },

  value_premise_id: {
    type: Number,
    required: [true, "value_premise_id is required"],
  },

  report_type: String,

  valued_at: {
    type: String,
    required: [true, "valued_at is required"],
    set: toYMD,
  },

  submitted_at: {
    type: String,
    required: [true, "submitted_at is required"],
    set: toYMD,
  },

  inspection_date: {
    type: String,
    required: [true, "inspection_date is required"],
    set: toYMD,
  },

  assumptions: Number,
  number_of_macros: Number,
  special_assumptions: Number,

  telephone: {
    type: String,
    required: [true, "telephone is required"],
    minlength: [8, "telephone must be at least 8 characters"],
    trim: true,
  },

  email: {
    type: String,
    required: [true, "email is required"],
    trim: true,
    lowercase: true,
    match: [/^\S+@\S+\.\S+$/, "email must be a valid email address"],
  },

  valuers: [
    {
      valuerId: String,
      valuerName: String,
      percentage: Number
    }
  ],

  // OVERRIDE value = final_value from market
  final_value: {
    type: Number,
    required: [true, "final_value is required"],
    validate: {
      validator: function (v) {
        return typeof v === "number" && Number.isFinite(v) && v > 0; // non-zero, non-negative, only number
      },
      message: "final_value must be a valid number greater than 0",
    },
  },

  region: {
    type: String,
    required: [true, "region is required"],
    trim: true,
  },

  city: {
    type: String,
    required: [true, "city is required"],
    trim: true,
  },

  // Asset fields
  asset_id: Number,

  asset_name: {
    type: String,
    required: [true, "asset_name is required"],
    trim: true,
  },

  asset_usage: {
    type: String,
    required: [true, "asset_usage is required"],
    trim: true,
  },

  // PDF
  pdf_path: String,

  // Submission tracking
  submit_state: { type: Number, default: 0 }, // 0 = incomplete/not checked, 1 = complete
  report_status: { type: String, default: "INCOMPLETE" }, // INCOMPLETE | COMPLETE | SENT | CONFIRMED
  last_checked_at: { type: Date }
}, { timestamps: true });

// Date of Valuation must be on or before Report Issuing Date
urgentSchema.pre("validate", function () {
  if (this.valued_at && this.submitted_at) {
    const valued = new Date(this.valued_at);
    const submitted = new Date(this.submitted_at);
    if (!isNaN(valued.getTime()) && !isNaN(submitted.getTime()) && valued > submitted) {
      this.invalidate("valued_at", "Date of Valuation must be on or before Report Issuing Date");
    }
  }
  // next();
});

const UrgentReport = mongoose.model('UrgentReport', urgentSchema);

module.exports = UrgentReport;
