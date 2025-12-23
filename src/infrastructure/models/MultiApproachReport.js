const mongoose = require("mongoose");

const ValuerSchema = new mongoose.Schema(
  {
    valuer_name: { type: String },
    contribution_percentage: { type: Number },
  },
  { _id: false }
);

const AssetSchema = new mongoose.Schema(
  {
    asset_id: { type: Number },
    asset_name: { type: String, required: true },
    asset_usage_id: { type: Number, required: true },
    asset_type: { type: String, default: "0" },

    // Repeated high-level fields (copied from parent report)
    region: { type: String , required: true},
    city: { type: String , required: true},
    inspection_date: { type: String , required:true }, // yyyy-mm-dd
    owner_name: { type: String, required: true },

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

    client_name: {
      type: String,
      required: [true, "Client name is required"],
      trim: true,
      minlength: [9, "Client name must be at least 9 characters long"],
    },


    owner_name: { type: String },
    purpose_id: { type: Number, required: true },
    value_premise_id: { type: Number, required: true },
    report_type: { type: String, required: true },

    // Store as yyyy-mm-dd string (not Date)
    valued_at: { type: String, required: true }, // yyyy-mm-dd
    submitted_at: { type: String, required: true }, // yyyy-mm-dd
    inspection_date: { type: String, required: true }, // yyyy-mm-dd

    assumptions: { type: String },
    special_assumptions: { type: String },

    telephone: {
      type: String,
      required: [true, "Telephone number is required"],
      trim: true,
      validate: {
        validator: function (v) {
          // remove everything except digits
          const digitsOnly = v.replace(/\D/g, "");
          return digitsOnly.length >= 8;
        },
        message: "Telephone number must contain at least 8 digits",
      },
    },
    email: {
      type: String,
      required: [true, "Email address is required"],
      trim: true,
    },

    region: { type: String },
    city: { type: String },

    valuation_currency: { type: String },
    has_other_users: { type: Boolean, default: false },
    report_users: {
      type: [String],
      default: [],
    },
    valuers: {
      type: [ValuerSchema],
      default: [],
    },

    // Total value from Report Info
    value: { type: Number },
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



MultiApproachReportSchema.pre("validate", function () {
  const doc = this;

  if (!doc.valued_at || !doc.submitted_at) {
    const err = new mongoose.Error.ValidationError(doc);
    err.addError(
      "valued_at",
      new mongoose.Error.ValidatorError({
        message: "valued_at and submitted_at are required fields",
        path: "valued_at",
        value: doc.valued_at,
      })
    );
    throw err;
  }

  if (doc.valued_at > doc.submitted_at) {
    const err = new mongoose.Error.ValidationError(doc);
    err.addError(
      "valued_at",
      new mongoose.Error.ValidatorError({
        message:
          "Date of Valuation must be on or before Report Issuing Date (submitted_at)",
        path: "valued_at",
        value: doc.valued_at,
      })
    );
    throw err;
  }
});



function toYyyyMmDd(value) {
  if (!value) return "";
  if (value instanceof Date) {
    const yyyy = value.getFullYear();
    const mm = String(value.getMonth() + 1).padStart(2, "0");
    const dd = String(value.getDate() + 1).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  // Assume it's already a string, just return it
  return value;
}

MultiApproachReportSchema.pre("save", function () {
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

  // next();
});

module.exports = mongoose.model(
  "MultiApproachReport",
  MultiApproachReportSchema
);
