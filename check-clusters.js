// check-clusters.js
const { MongoClient } = require("mongodb");

async function check(uri, label) {
  const client = new MongoClient(uri);
  await client.connect();
  const dbs = await client.db().admin().listDatabases();
  console.log(`\n=== ${label} ===`);
  console.log(
    "Databases:",
    dbs.databases.map((d) => d.name),
  );
  for (const dbInfo of dbs.databases) {
    const db = client.db(dbInfo.name);
    const collections = await db.listCollections().toArray();
    const names = collections.map((c) => c.name);
    if (names.includes("users") || names.includes("companes")) {
      console.log(`  [${dbInfo.name}] collections:`, names);
      if (names.includes("companes")) {
        const count = await db.collection("companes").countDocuments();
        console.log(`    companes count: ${count}`);
      }
      if (names.includes("users")) {
        const count = await db.collection("users").countDocuments();
        console.log(`    users count: ${count}`);
      }
    }
  }
  await client.close();
}

(async () => {
  await check(process.env.MONGODB_URI, "MONGODB_URI (sparkvisionInd)");
  await check(process.env.SPARK_DB, "SPARK_DB (Cluster0)");
})();
