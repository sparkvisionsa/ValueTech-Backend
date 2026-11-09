const mongoose = require("mongoose");
const { getElectronDbConnection } = require("../electronDb");

const UserSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, trim: true },
    usernameLower: { type: String, required: true, index: true },
    passwordHash: { type: String, required: true, select: false }, // never returned unless explicitly requested
    phone: { type: String, default: "" },

    // valuation report signature details
    valuationReportDisplayName: { type: String, default: "" },
    valuationReportJobTitle: { type: String, default: "" },
    valuationReportMembershipNo: { type: String, default: "" },

    role: { type: String, default: "valuer" },
    company: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },

    lastLoginAt: { type: Date, default: null },
    isBlocked: { type: Boolean, default: false },
    blockedAt: { type: Date, default: null },
  },
  {
    collection: "users", // must match the first app's collection name
    timestamps: true, // maps to createdAt / updatedAt
  },
);

const conn = getElectronDbConnection();
const User = conn.model("User", UserSchema);

module.exports = User;
