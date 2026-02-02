const mongoose = require("mongoose");

const MapCoordsSchema = new mongoose.Schema(
  { lat: Number, lng: Number },
  { _id: false }
);

const MapSchema = new mongoose.Schema(
  { url: String, coords: MapCoordsSchema },
  { _id: false }
);

const FeesSchema = new mongoose.Schema(
  {
    map: mongoose.Schema.Types.Mixed,
    totalText: String,
    totalNumber: Number,
  },
  { _id: false }
);

const MobasherSchema = new mongoose.Schema(
  {
    source: { type: String, default: "mobasher" },
    url: { type: String, required: true },

    adId: { type: String, required: true },

    title: { type: String, default: "" },
    description: { type: String, default: "" },

    price: { type: Number, default: null },
    priceText: { type: String, default: "" },

    location: { type: String, default: "" },

    expiry: { type: String, default: "" },
    preferredTime: { type: String, default: "" },

    specs: { type: mongoose.Schema.Types.Mixed, default: {} },
    fees: { type: FeesSchema, default: null },

    images: { type: [String], default: [] },
    mainImage: { type: String, default: "" },

    map: { type: MapSchema, default: null },

    scrapedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// helpful indexes
MobasherSchema.index({ adId: 1 });
MobasherSchema.index({ scrapedAt: -1 });
MobasherSchema.index({ title: "text", description: "text" });

module.exports = mongoose.model("Mobasher", MobasherSchema, "mobasher"); // <-- collection EXACTLY "mobasher"
