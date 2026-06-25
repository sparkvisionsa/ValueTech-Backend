const mongoose = require("mongoose");

const ELECTRON_DB_URI = process.env.SPARK_DB;

const ELECTRON_DB_NAME = "ElectronDB";

let electronConnection = null;

/**
 * Returns a Mongoose connection pointed at ElectronDB.
 * The connection is created once and reused on subsequent calls.
 */
const getElectronDbConnection = () => {
  if (!electronConnection) {
    electronConnection = mongoose.createConnection(ELECTRON_DB_URI, {
      dbName: ELECTRON_DB_NAME,
    });

    electronConnection.on("connected", () =>
      console.log("Connected to ElectronDB (transactions source)"),
    );
    electronConnection.on("error", (err) =>
      console.error("ElectronDB connection error:", err),
    );
  }
  return electronConnection;
};

/**
 * Ensures the connection is open before use.
 * Safe to call multiple times — resolves immediately once connected.
 */
const connectElectronDb = async () => {
  const conn = getElectronDbConnection();
  await conn.asPromise();
  return conn;
};

module.exports = { getElectronDbConnection, connectElectronDb };
