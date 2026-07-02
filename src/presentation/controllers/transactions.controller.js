const mongoose = require("mongoose");
const Transaction = require("../../infrastructure/models/transaction.model");
const Client = require("../../infrastructure/models/client.model");
const Region = require("../../infrastructure/models/region.model");
const City = require("../../infrastructure/models/city.model");

/**
 * GET /api/transactions
 */
async function listTransactions(req, res) {
  try {
    const {
      companyId,
      inspectorId,
      isCompleted,
      isOpened,
      page = 1,
      limit = 20,
    } = req.query;

    const filter = {};

    if (companyId) filter.companyId = String(companyId).trim();
    if (inspectorId) filter.assignedInspectorIds = String(inspectorId).trim();
    if (isCompleted === "true") filter.isCompleted = true;
    if (isCompleted === "false") filter.isCompleted = false;
    if (isOpened === "true") filter.isOpened = true;
    if (isOpened === "false") filter.isOpened = false;

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(100, Math.max(1, Number(limit) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [items, total] = await Promise.all([
      Transaction.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Transaction.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      page: pageNum,
      limit: limitNum,
      total,
      items: items.map(serializeTransaction),
    });
  } catch (err) {
    console.error("listTransactions error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

/**
 * GET /api/transactions/:id
 * Used by RealEstateFiller.fetch_record_by_id — returns the record
 * pre-flattened into the shape extract_record_values() expects.
 */
async function getTransaction(req, res) {
  try {
    const doc = await Transaction.findById(req.params.id).lean();
    if (!doc) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    const evalData = doc.evalData ?? {};

    const [clientsById, regionsById, citiesById] = await Promise.all([
      fetchClientsByIds([doc.clientId]),
      fetchRegionsByIds([evalData.regionId]),
      fetchCitiesByIds([evalData.cityId]),
    ]);

    const client = doc.clientId ? clientsById.get(String(doc.clientId)) : null;
    const region = evalData.regionId
      ? regionsById.get(String(evalData.regionId))
      : null;
    const city = evalData.cityId
      ? citiesById.get(String(evalData.cityId))
      : null;

    return res.json({
      success: true,
      item: serializeTransactionForFiller(doc, client, region, city),
    });
  } catch (err) {
    console.error("getTransaction error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

/**
 * POST /api/transactions/bulk
 * Used by RealEstateFiller.fetch_records_by_ids — same flattened shape
 * as getTransaction, just for many records at once.
 */
async function bulkGetTransactions(req, res) {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "ids must be a non-empty array" });
    }

    const validIds = ids.filter((id) => mongoose.Types.ObjectId.isValid(id));
    if (validIds.length === 0) {
      return res.json({ success: true, items: [] });
    }

    const docs = await Transaction.find({ _id: { $in: validIds } }).lean();

    const [clientsById, regionsById, citiesById] = await Promise.all([
      fetchClientsByIds(docs.map((d) => d.clientId)),
      fetchRegionsByIds(docs.map((d) => d.evalData?.regionId)),
      fetchCitiesByIds(docs.map((d) => d.evalData?.cityId)),
    ]);

    return res.json({
      success: true,
      items: docs.map((doc) => {
        const evalData = doc.evalData ?? {};
        return serializeTransactionForFiller(
          doc,
          doc.clientId ? clientsById.get(String(doc.clientId)) : null,
          evalData.regionId ? regionsById.get(String(evalData.regionId)) : null,
          evalData.cityId ? citiesById.get(String(evalData.cityId)) : null,
        );
      }),
    });
  } catch (err) {
    console.error("bulkGetTransactions error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

/**
 * PATCH /api/transactions/:id/set-report-id
 */
async function setReportId(req, res) {
  try {
    const { report_id } = req.body || {};
    if (!report_id || typeof report_id !== "string") {
      return res
        .status(400)
        .json({ success: false, message: "report_id is required" });
    }

    const updated = await Transaction.findByIdAndUpdate(
      req.params.id,
      { $set: { reportId: report_id } },
      { new: true },
    ).lean();

    if (!updated) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    return res.json({ success: true, item: serializeTransaction(updated) });
  } catch (err) {
    console.error("setReportId error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Looks up Client docs for a batch of clientId values in one query, and
 * returns a Map keyed by clientId string -> { name, phone, email }.
 *
 * clientId is stored on Transaction as a free-form String, so we only
 * attempt the lookup for values that are actually valid ObjectIds (the
 * `clients` collection's _id). Anything else is silently skipped rather
 * than thrown, since clientId may be blank or legacy data on some records.
 */
async function fetchClientsByIds(clientIds) {
  const uniqueIds = [...new Set((clientIds || []).filter(Boolean))];
  if (uniqueIds.length === 0) return new Map();

  const validIds = uniqueIds.filter((id) =>
    mongoose.Types.ObjectId.isValid(id),
  );
  if (validIds.length === 0) return new Map();

  const clients = await Client.find({ _id: { $in: validIds } })
    .select({ name: 1, phone: 1, email: 1 })
    .lean();

  const map = new Map();
  for (const c of clients) {
    map.set(c._id.toString(), {
      name: c.name ?? null,
      phone: c.phone ?? null,
      email: c.email ?? null,
    });
  }
  console.log("map", map);
  return map;
}

/**
 * Looks up Region docs for a batch of evalData.regionId values in one
 * query, and returns a Map keyed by regionId string -> { taqeemId }.
 *
 * Same lenient-lookup behavior as fetchClientsByIds: regionId is a
 * free-form String on the Transaction's evalData, so only values that
 * are valid ObjectIds (the `regions` collection's _id) are looked up.
 */
async function fetchRegionsByIds(regionIds) {
  const uniqueIds = [...new Set((regionIds || []).filter(Boolean))];
  if (uniqueIds.length === 0) return new Map();

  const validIds = uniqueIds.filter((id) =>
    mongoose.Types.ObjectId.isValid(id),
  );
  if (validIds.length === 0) return new Map();

  const regions = await Region.find({ _id: { $in: validIds } })
    .select({ taqeemId: 1 })
    .lean();

  const map = new Map();
  for (const r of regions) {
    map.set(r._id.toString(), { taqeemId: r.taqeemId ?? null });
  }
  return map;
}

/**
 * Same as fetchRegionsByIds, but for the `cities` collection, keyed off
 * evalData.cityId.
 */
async function fetchCitiesByIds(cityIds) {
  const uniqueIds = [...new Set((cityIds || []).filter(Boolean))];
  if (uniqueIds.length === 0) return new Map();

  const validIds = uniqueIds.filter((id) =>
    mongoose.Types.ObjectId.isValid(id),
  );
  if (validIds.length === 0) return new Map();

  const cities = await City.find({ _id: { $in: validIds } })
    .select({ taqeemId: 1 })
    .lean();

  const map = new Map();
  for (const c of cities) {
    map.set(c._id.toString(), { taqeemId: c.taqeemId ?? null });
  }
  return map;
}

/**
 * General-purpose serializer for listing — keeps evalData nested,
 * unchanged from before.
 */
function serializeTransaction(doc) {
  return {
    id: doc._id.toString(),
    assignmentNumber: doc.assignmentNumber ?? "",
    authorizationNumber: doc.authorizationNumber ?? "",
    assignmentDate: doc.assignmentDate ?? "",
    assignedInspectorIds: doc.assignedInspectorIds ?? [],
    valuationPurpose: doc.valuationPurpose ?? "",
    intendedUse: doc.intendedUse ?? "",
    valuationBasis: doc.valuationBasis ?? "",
    priority: doc.priority ?? "normal",
    attachmentsCount: doc.attachmentsCount ?? 0,
    imagesCount: doc.imagesCount ?? 0,
    ownershipType: doc.ownershipType ?? "",
    valuationHypothesis: doc.valuationHypothesis ?? "",
    clientId: doc.clientId ?? "",
    branch: doc.branch ?? "",
    templateId: doc.templateId ?? null,
    companyId: doc.companyId ?? null,
    createdByUserId: doc.createdByUserId ?? null,
    templateFieldValues: doc.templateFieldValues ?? {},
    evalData: doc.evalData ?? {},
    isOpened: doc.isOpened ?? false,
    isCompleted: doc.isCompleted ?? false,
    reportId: doc.reportId ?? null,
    submitState: doc.submitState ?? 0,
    createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : null,
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : null,
  };
}

/**
 * Builds the `valuers` array used by create_and_submit_report() to decide
 * whether to run the valuers step. There's no explicit `valuers` field in
 * the schema, so this is inferred from the author1..4 slots — flagging
 * that assumption in case the form actually needs a different shape.
 */
function buildValuers(evalData) {
  return [1, 2, 3, 4]
    .map((n) => ({
      id: evalData[`author${n}Id`] || null,
      title: evalData[`author${n}Title`] || null,
    }))
    .filter((v) => v.id);
}

/**
 * Mirrors extract_record_values() from realEstateSteps.py field-for-field,
 * so the Python side gets data already shaped to match field_map_1/2/3
 * instead of having to dig into evalData itself.
 *
 * `client` (optional) is the { name, phone, email } looked up from the
 * `clients` collection via doc.clientId. When present, it takes priority
 * over evalData for the corresponding fields, since the clients collection
 * is the source of truth for that contact info and evalData.clientName /
 * evalData.contactNo are often stale copies entered by hand on the form.
 *
 * `region` / `city` (optional) are the { taqeemId } docs looked up from
 * the `regions` / `cities` collections via evalData.regionId /
 * evalData.cityId. taqeemId is the only field needed from each, surfaced
 * as regionTaqeemId / cityTaqeemId alongside the existing regionName /
 * cityName (which still come straight from evalData).
 */
function buildFillerValues(doc, client, region, city) {
  const evalData = doc.evalData ?? {};
  const buildingCondition = evalData.buildingCondition ?? {};

  return {
    // ── Step 1 ─────────────────────────────────────────────
    report_title: doc.assignmentNumber ?? "0", // missing from record
    valuationPurpose: doc.valuationPurpose ?? null, // top-level
    valuationHypothesis: doc.valuationHypothesis ?? null, // top-level
    valuationBasis: doc.valuationBasis ?? null, // top-level
    report_type: null, // missing from record
    evalDate: evalData.evalDate ?? null,
    reportDate: evalData.reportDate ?? null,
    assumptions: evalData.assumptions ?? null,
    special_assumptions: null, // missing from record
    finalAssetValue: evalData.finalAssetValue ?? null,
    valuation_currency: null, // missing from record
    report_asset_file: null, // missing from record
    // sourced from the `clients` collection via doc.clientId; falls back
    // to the evalData copy if the client lookup didn't resolve
    clientName: client?.name ?? evalData.clientName ?? null,
    contactNo: client?.phone ?? evalData.contactNo ?? null,
    // previously always null ("missing from record") — now sourced from
    // the clients collection
    email_address: client?.email ?? null,
    otherUsers: evalData.otherUsers ?? null,
    // NOTE: this was the actual bug — extract_record_values() reads
    // record.get("author1Id") at the TOP level, but author1Id only lives
    // under evalData in the schema. Surfacing it here so the lookup works.
    valuer_name: evalData.author1Id ?? null,
    contribution_percentage: null, // missing from record

    // ── Step 2 ─────────────────────────────────────────────
    propertyType: evalData.propertyType ?? null,
    inspected_at: evalData.evalDate ?? null, // closest match
    marketMethodTotal: evalData.marketMethodTotal ?? null,
    marketMeterPrice: evalData.marketMeterPrice ?? null,
    incomeTotal: evalData.incomeTotal ?? null,
    incomeReason: evalData.incomeReason ?? null,
    costLandBuildTotal: evalData.costLandBuildTotal ?? null,
    costReason: evalData.costReason ?? null,
    lng: evalData.lng ?? null,
    lat: evalData.lat ?? null,
    landUse: evalData.landUse ?? null,
    country: null, // missing from record
    regionName: evalData.regionName ?? null,
    cityName: evalData.cityName ?? null,
    // sourced from the `regions` / `cities` collections via
    // evalData.regionId / evalData.cityId
    regionTaqeemId: region?.taqeemId ?? null,
    cityTaqeemId: city?.taqeemId ?? null,

    // ── Step 3 ─────────────────────────────────────────────
    blockNumber: evalData.blockNumber ?? null,
    parcelNumber: evalData.parcelNumber ?? null,
    deedNumber: evalData.deedNumber ?? null,
    ownershipType: doc.ownershipType ?? null, // top-level
    ownershipPercentage: evalData.ownershipPercentage ?? null,
    rental_duration: null, // missing from record
    rental_end_date: null, // missing from record
    street_facing_fronts: null, // missing from record
    distance_from_city_center: null, // missing from record
    surroundingEnvironment: evalData.surroundingEnvironment ?? null,
    landSpace: evalData.landSpace ?? null,
    propertyArea: evalData.propertyArea ?? null,
    authorized_land_cover_percentage: null, // missing from record
    authorized_height: null, // missing from record
    land_leased: null, // missing from record
    buildingCondition: buildingCondition.status ?? null,
    finishLevel: evalData.finishLevel ?? null,
    furnishing_status: null, // missing from record
    air_conditioning: null, // missing from record
    propertyModel: evalData.propertyModel ?? null,
    availableServices: evalData.availableServices ?? null,
    propertyAge: evalData.propertyAge ?? null,
    street: evalData.street ?? null,
  };
}

/**
 * Serializer used by getTransaction / bulkGetTransactions — the filler
 * script's consumers. Returns base record fields PLUS the flattened
 * field-map values, PLUS `valuers`, so the script can use the record
 * almost directly without redoing the evalData extraction itself.
 *
 * `client` (optional) is passed straight through to buildFillerValues
 * so clientName / contactNo / email_address can be sourced from the
 * `clients` collection instead of (only) evalData.
 *
 * `region` / `city` (optional) are likewise passed straight through so
 * regionTaqeemId / cityTaqeemId can be sourced from the `regions` /
 * `cities` collections.
 */
function serializeTransactionForFiller(doc, client, region, city) {
  const evalData = doc.evalData ?? {};

  return {
    // exposed under both keys: the script tracks records by `id` but
    // patches the report id back using `_id`
    id: doc._id.toString(),
    _id: doc._id.toString(),

    ...buildFillerValues(doc, client, region, city),

    // drives the is_valuers_step branch in create_and_submit_report()
    valuers: buildValuers(evalData),

    // raw evalData kept too, in case anything downstream still wants it
    evalData,

    reportId: doc.reportId ?? null,
    isOpened: doc.isOpened ?? false,
    isCompleted: doc.isCompleted ?? false,
    submitState: doc.submitState ?? 0,
  };
}

module.exports = {
  listTransactions,
  getTransaction,
  bulkGetTransactions,
  setReportId,
};
