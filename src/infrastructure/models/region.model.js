const mongoose = require("mongoose");
const { getElectronDbConnection } = require("../electronDb");

const RegionSchema = new mongoose.Schema(
  {
    titleAr: { type: String, default: null },
    titleEn: { type: String, default: null },
    taqeemId: { type: String, default: null },
  },
  {
    collection: "regions", // must match the owning app's collection name
    strict: false,
  },
);

// Same ElectronDB connection as Transaction — regions live in the same DB.
const conn = getElectronDbConnection();
const Region = conn.model("Region", RegionSchema);

module.exports = Region;
