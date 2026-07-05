// migrate-real-estate-companes.js
const { MongoClient, ObjectId } = require("mongodb");

const TARGET_USER_ID = "6a0ef4681a9e4a15235115bd"; // ← the live user you actually log in as; confirm first
const SOURCE_IDS = ["6a43ab30b1e16120b72ac3a8", "6a43ab30b1e16120b72ac3a9"];

(async () => {
  const sourceClient = new MongoClient(process.env.SPARK_DB);
  const destClient = new MongoClient(process.env.MONGODB_URI);
  await sourceClient.connect();
  await destClient.connect();

  const sourceDb = sourceClient.db("test");
  const destDb = destClient.db("ElectronDB");

  const docs = await sourceDb
    .collection("companes")
    .find({ _id: { $in: SOURCE_IDS.map((id) => new ObjectId(id)) } })
    .toArray();

  console.log(`Found ${docs.length} documents to migrate`);

  for (const doc of docs) {
    // Reassign ownership to the correct live user
    doc.user = new ObjectId(TARGET_USER_ID);

    // Check for an existing doc with the same officeId+type+user to avoid dupes
    const existing = await destDb.collection("companes").findOne({
      officeId: doc.officeId,
      type: doc.type,
      user: doc.user,
    });

    if (existing) {
      console.log(
        `Skipping ${doc.name} (${doc.officeId}) — already exists in destination`,
      );
      continue;
    }

    const { _id, ...rest } = doc; // let dest assign a fresh _id to avoid collisions
    const result = await destDb.collection("companes").insertOne(rest);
    console.log(
      `Migrated ${doc.name} (${doc.officeId}) → new _id ${result.insertedId}`,
    );
  }

  await sourceClient.close();
  await destClient.close();
})();
