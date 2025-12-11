const mongoose = require("mongoose");

const AssetSchema = new mongoose.Schema(
  {
    asset_id: { type: Number },
    asset_name: { type: String },
    asset_usage_id: { type: Number },
    asset_type: { type: String, default: "0" },

    // Repeated high-level fields (copied from parent report)
    region: { type: String },
    city: { type: String },
    inspection_date: { type: String }, // yyyy-mm-dd
    owner_name: { type: String },

    source_sheet: {
      type: String,
      enum: ["market", "cost"],
      required: true,
    },

    final_value: {
      type: Number,
      required: true,
      validate: {
        validator: (v) => Number.isInteger(v),
        message: "final_value must be an integer.",
      },
    },

    // Flags & values for approaches
    market_approach: { type: String },       // "1" or "-"
    market_approach_value: { type: String }, // store as string

    cost_approach: { type: String },         // "1" or "-"
    cost_approach_value: { type: String },   // string

    production_capacity: { type: String, default: "0" },
    production_capacity_measuring_unit: { type: String, default: "0" },
    product_type: { type: String, default: "0" },

  },
  { _id: false }
);

const MultiApproachReportSchema = new mongoose.Schema(
  {
    batchId: {
      type: String,
      required: true,
      index: true,
    },

    excel_name: { type: String, required: true },
    excel_basename: { type: String, required: true },

    // Report Info (flattened important fields)
    title: { type: String },
    client_name: { type: String },
    owner_name: { type: String },
    purpose_id: { type: Number },
    value_premise_id: { type: Number },
    report_type: { type: String },

    // Store as yyyy-mm-dd string (not Date)
    valued_at: { type: String },
    submitted_at: { type: String },
    inspection_date: { type: String }, // yyyy-mm-dd

    assumptions: { type: String },
    special_assumptions: { type: String },

    telephone: { type: String },
    email: { type: String },

    region: { type: String },
    city: { type: String },

    // Total value from Report Info
    final_value: { type: Number, required: true },

    // Sum of final_value from all assets (market + cost)
    assets_total_value: { type: Number, required: true },

    // All assets combined (renamed from `assets`)
    asset_data: {
      type: [AssetSchema],
      default: [],
    },

    // Single PDF stored as string path (instead of array)
    pdf_path: {
      type: String,
      default: "",
    },

    // Optional: store full raw Report Info row

  },
  { timestamps: true }
);

function toYyyyMmDd(value) {
  if (!value) return "";
  if (value instanceof Date) {
    const yyyy = value.getFullYear();
    const mm = String(value.getMonth() + 1).padStart(2, "0");
    const dd = String(value.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  // Assume it's already a string, just return it
  return value;
}

MultiApproachReportSchema.pre("save", function (next) {
  const doc = this;

  // Normalize top-level dates to yyyy-mm-dd strings
  doc.valued_at = toYyyyMmDd(doc.valued_at);
  doc.submitted_at = toYyyyMmDd(doc.submitted_at);
  doc.inspection_date = toYyyyMmDd(doc.inspection_date);

  // Copy selected fields into each asset
  if (Array.isArray(doc.asset_data)) {
    doc.asset_data.forEach((asset) => {
      if (!asset) return;

      asset.region = doc.region || asset.region || "";
      asset.city = doc.city || asset.city || "";
      asset.owner_name = doc.owner_name || asset.owner_name || "";
      asset.inspection_date =
        toYyyyMmDd(doc.inspection_date || asset.inspection_date);
    });
  }

  next();
});

module.exports = mongoose.model(
  "MultiApproachReport",
  MultiApproachReportSchema
);
