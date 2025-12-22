const e = require('express');
const mongoose = require('mongoose');

const urgentSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  user_phone: { type: String },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', default: null },
  report_id: { type: String },
  source_excel_name: { type: String },
  title: String,
  batch_id: String,
  client_name: String,
  purpose_id: Number,
  value_premise_id: Number,
  report_type: String,
  valued_at: Date,
  submitted_at: Date,
  inspection_date: Date,
  assumptions: Number,
  number_of_macros: Number,
  special_assumptions: Number,
  telephone: String,
  email: String,
  valuers: [
    {
      valuerId: String,
      valuerName: String,
      percentage: Number
    }
  ],

  // OVERRIDE value = final_value from market
  final_value: Number,

  region: String,
  city: String,

  // Asset fields
  asset_id: Number,
  asset_name: String,
  asset_usage: String,

  // PDF
  pdf_path: String,

  // Submission tracking
  submit_state: { type: Number, default: 0 }, // 0 = incomplete/not checked, 1 = complete
  report_status: { type: String, default: "INCOMPLETE" }, // INCOMPLETE | COMPLETE | SENT | CONFIRMED
  last_checked_at: { type: Date }
}, { timestamps: true });
const UrgentReport = mongoose.model('UrgentReport', urgentSchema);


module.exports = UrgentReport;
