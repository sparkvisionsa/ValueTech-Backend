// src/models/yalla.model.js
const mongoose = require("mongoose");

const YallaSchema = new mongoose.Schema(
  {
    _id: { type: String }, // URL
    url: { type: String },
    source: String,
    type: String,

    cardTitle: String,
    cardPriceText: String,

    fetchedAt: Date,
    lastSeenAt: Date,
    listPageUrl: String,
    sectionLabel: String,
    pageNo: Number,

    detail: mongoose.Schema.Types.Mixed,
    detailScrapedAt: Date,
  },
  { collection: "yallamotortest", strict: false }
);

module.exports = mongoose.model("YallaModel", YallaSchema);
