const { MongoClient } = require("mongodb");

(async () => {
  const client = new MongoClient(process.env.SPARK_DB);
  await client.connect();
  const db = client.db("test");
  const companes = await db.collection("companes").find({}).toArray();
  companes.forEach((c) =>
    console.log({
      _id: c._id.toString(),
      name: c.name,
      officeId: c.officeId,
      type: c.type,
      user: c.user ? c.user.toString() : null,
    }),
  );
  await client.close();
})();
