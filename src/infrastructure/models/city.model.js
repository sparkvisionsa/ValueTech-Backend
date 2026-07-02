const mongoose = require("mongoose");
const { getElectronDbConnection } = require("../electronDb");

const CitySchema = new mongoose.Schema(
  {
    titleAr: { type: String, default: null },
    titleEn: { type: String, default: null },
    regionId: { type: String, default: null },
    active: { type: Boolean, default: true },
    descriptionAr: { type: String, default: "" },
    descriptionEn: { type: String, default: "" },
    taqeemId: { type: String, default: null },
  },
  {
    collection: "cities", // must match the owning app's collection name
    strict: false,
  },
);

// Same ElectronDB connection as Transaction — cities live in the same DB.
const conn = getElectronDbConnection();
const City = conn.model("City", CitySchema);

module.exports = City;
