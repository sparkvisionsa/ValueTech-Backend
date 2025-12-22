const mongoose = require('mongoose');

const valuerSchema = new mongoose.Schema({
  valuer_name: { type: String },
  contribution_percentage: { type: Number },
}, { _id: false });

const assetSchema = new mongoose.Schema({
  id: { type: String },
  serial_no: { type: String },
  asset_type: { type: String, default: "0" },
  asset_name: { type: String },
  inspection_date: { type: String },
  owner_name: { type: String },
  submitState: { type: Number, default: 0 },
  final_value: { type: String },
  asset_usage_id: { type: String },
  value_base: { type: String },
  production_capacity: { type: String, default: "0" },
  production_capacity_measuring_unit: { type: String, default: "0" },
  product_type: { type: String, default: "0" },
  market_approach: { type: String },
  market_approach_value: { type: String },
  cost_approach: { type: String },
  cost_approach_value: { type: String },
  country: { type: String, default: "المملكة العربية السعودية" },
  region: { type: String },
  city: { type: String },
}, { _id: false });

const duplicateReportSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  user_phone: { type: String },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', default: null },

  report_id: { type: String },
  title: { type: String },
  purpose_id: { type: String },
  value_premise_id: { type: String },
  report_type: { type: String },
  valued_at: { type: String },
  submitted_at: { type: String },
  assumptions: { type: String },
  special_assumptions: { type: String },
  value: { type: String },
  valuation_currency: { type: String },
  owner_name: { type: String },
  inspection_date: { type: String },

  pdf_path: { type: String },
  client_name: { type: String },

  telephone: { type: String },
  email: { type: String },
  has_other_users: { type: Boolean, default: false },
  report_users: { type: [String], default: [] },
  valuers: { type: [valuerSchema], default: [] },

  startSubmitTime: { type: Date },
  endSubmitTime: { type: Date },

  checked: { type: Boolean, default: false },

  asset_data: { type: [assetSchema], default: [] },
}, { timestamps: true });

module.exports = mongoose.model('DuplicateReport', duplicateReportSchema);
