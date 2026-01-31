const mongoose = require("mongoose");

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatLocalYMD(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// Convert excel serial -> Date (local safe output)
function excelSerialToDate(serial) {
  const msPerDay = 24 * 60 * 60 * 1000;
  const excelEpoch1970 = 25569; // serial for 1970-01-01
  const days = serial - excelEpoch1970;
  return new Date(days * msPerDay);
}

function toYMD(value) {
  if (value === null || value === undefined || value === "") return value;

  const formatLocal = (d) =>
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

  // If string
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return value;

    // already yyyy-mm-dd
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

    // ISO string -> strip date part only (do NOT parse to Date)
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10);

    // try parse and format LOCAL
    const d = new Date(s);
    if (!isNaN(d.getTime())) return formatLocal(d);

    return value;
  }

  // If Date object -> format LOCAL (no ISO)
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return value;
    return formatLocal(value);
  }

  // number: could be Excel serial OR JS timestamp
  if (typeof value === "number") {
    // Excel serial date range usually ~ 1..60000
    if (value > 0 && value < 100000) {
      const d = excelSerialToDate(value);
      if (!isNaN(d.getTime())) return formatLocal(d);
      return value;
    }

    // assume ms timestamp
    const d = new Date(value);
    if (!isNaN(d.getTime())) return formatLocal(d);
  }

  return value;
}

const ValuerSchema = new mongoose.Schema(
  {
    valuerName: { type: String },
    percentage: { type: Number },
  },
  { _id: false }
);

const AssetSchema = new mongoose.Schema(
  {
    id: { type: String },
    asset_id: { type: Number },
    asset_name: { type: String, required: true },
    asset_usage_id: { type: Number, required: true },
    asset_type: { type: String, default: "0" },

    region: { type: String, required: true },
    city: { type: String, required: true },
    inspection_date: { type: String, required: true }, // yyyy-mm-dd
    owner_name: { type: String, default: "0" },

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
    pg_no: { type: String },
    submitState: { type: Number },

    market_approach: { type: String, default: "0" },
    market_approach_value: { type: String, default: "0" },

    cost_approach: { type: String, default: "0" },
    cost_approach_value: { type: String, default: "0" },

    production_capacity: { type: String, default: "0" },
    production_capacity_measuring_unit: { type: String, default: "0" },
    product_type: { type: String, default: "0" },
  },
  { _id: false }
);

const SubmitReportsQuicklySchema = new mongoose.Schema(
  {
    user_id: { type: String, ref: "User" },
    user_phone: { type: String },
    company: { type: mongoose.Schema.Types.ObjectId, ref: "Company", default: null },
    company_office_id: { type: String, default: null, index: true },
    report_id: { type: String, default: "" },
    source_excel_name: { type: String },
    title: { type: String, required: true },
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
      default: 1,
    },

    value_premise_id: {
      type: Number,
      required: [true, "value_premise_id is required"],
      default: 1,
    },

    report_type: {
      type: String,
      required: [true, "report_type is required"],
      default: "تقرير مفصل",
    },

    // Store as yyyy-mm-dd string (not Date)
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

    assumptions: { type: Number, default: 0 },
    special_assumptions: { type: Number, default: 0 },
    number_of_macros: { type: Number, default: 0 },

    telephone: {
      type: String,
      required: [true, "telephone is required"],
      default: "999999999",
      minlength: [8, "telephone must be at least 8 characters"],
      trim: true,
    },

    email: {
      type: String,
      required: [true, "email is required"],
      default: "a@a.com",
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, "email must be a valid email address"],
    },

    region: { type: String },
    city: { type: String },

    valuers: { type: [ValuerSchema], default: [] },

    final_value: {
      type: Number,
      required: [true, "final_value is required"],
      validate: {
        validator: function (v) {
          return typeof v === "number" && Number.isFinite(v) && v > 0;
        },
        message: "final_value must be a valid number greater than 0",
      },
    },

    asset_data: { type: [AssetSchema], default: [] },

    pdf_path: { type: String, default: "" },

    submit_state: { type: Number, default: 0 },
    report_status: { type: String, default: "new" },
    last_checked_at: { type: Date },
    checked: { type: Boolean, default: false },
    startSubmitTime: { type: Date },
    endSubmitTime: { type: Date },
    pg_count: { type: Number },
  },
  { timestamps: true }
);

// Date validation: valued_at must be <= submitted_at
SubmitReportsQuicklySchema.pre("validate", function () {
  if (this.valued_at && this.submitted_at) {
    const valued = new Date(this.valued_at);
    const submitted = new Date(this.submitted_at);
    if (!isNaN(valued.getTime()) && !isNaN(submitted.getTime()) && valued > submitted) {
      this.invalidate("valued_at", "Date of Valuation must be on or before Report Issuing Date");
    }
  }
});

SubmitReportsQuicklySchema.pre("insertMany", function () {
  // Support both possible signatures:
  // 1) (next, docs)
  // 2) (docs, next)
  const arg0 = arguments[0];
  const arg1 = arguments[1];

  const docs = Array.isArray(arg0) ? arg0 : arg1;
  const next = typeof arg0 === "function" ? arg0 : arg1;

  if (!Array.isArray(docs)) {
    if (typeof next === "function") return next();
    return;
  }

  docs.forEach((doc) => {
    doc.valued_at = toYMD(doc.valued_at);
    doc.submitted_at = toYMD(doc.submitted_at);
    doc.inspection_date = toYMD(doc.inspection_date);

    // copy into assets
    if (Array.isArray(doc.asset_data)) {
      doc.asset_data.forEach((asset) => {
        if (!asset) return;
        asset.region = doc.region || asset.region || "";
        asset.city = doc.city || asset.city || "";
        asset.owner_name = asset.owner_name || "0";
        if (doc.inspection_date) asset.inspection_date = doc.inspection_date;
      });
    }
  });

  if (typeof next === "function") return next();
});


const SubmitReportsQuickly = mongoose.model("SubmitReportsQuickly", SubmitReportsQuicklySchema);
module.exports = SubmitReportsQuickly;
