const mongoose = require("mongoose");
const { getElectronDbConnection } = require("../electronDb");

const ClientSchema = new mongoose.Schema(
  {
    name: { type: String, default: null },
    phone: { type: String, default: null },
    email: { type: String, default: null },
  },
  {
    collection: "clients", // must match the owning app's collection name
    strict: false,
  },
);

// Same ElectronDB connection as Transaction — clients live in the same DB.
const conn = getElectronDbConnection();
const Client = conn.model("Client", ClientSchema);

module.exports = Client;
