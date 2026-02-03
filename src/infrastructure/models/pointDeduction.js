const mongoose = require("mongoose");

const ReportSummarySchema = new mongoose.Schema(
  {
    reportId: { type: String },
    recordId: { type: String },
    clientName: { type: String },
    submittedAt: { type: Date },
    endSubmitTime: { type: Date },
    pageName: { type: String },
    pageSource: { type: String },
    assetCount: { type: Number, default: 0 },
  },
  { _id: false }
);

const PointDeductionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    amount: { type: Number, required: true },
    assetCount: { type: Number, default: 0 },
    remainingPoints: { type: Number },
    source: { type: String },
    pageName: { type: String },
    pageSource: { type: String },
    reportId: { type: String },
    reportIds: { type: [String], default: [] },
    recordId: { type: String },
    batchId: { type: String },
    message: { type: String },
    reportSummaries: { type: [ReportSummarySchema], default: [] },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PointDeduction", PointDeductionSchema);
