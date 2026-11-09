const mongoose = require("mongoose");
const Transaction = require("../../infrastructure/models/transaction.model");
const User = require("../../infrastructure/models/user.model")
const Client = require("../../infrastructure/models/client.model");
const Region = require("../../infrastructure/models/region.model");
const City = require("../../infrastructure/models/city.model");

/**
 * GET /api/transactions
 */

async function resolveCompanyIdsForUser(userId) {
  if (!mongoose.Types.ObjectId.isValid(userId)) return [];
  const user = await User.findById(userId).select({ company: 1 }).lean();
  // company is an ObjectId on User, but Transaction.companyId is a String,
  // so convert before filtering.
  return user?.company ? [String(user.company)] : [];
}

/**
 * GET /api/transactions
 *
 * Query params:
 *   memberOfUserId - resolves the user's company and lists that company's transactions
 *   companyId      - filter by an explicit company id (ignored if memberOfUserId is set)
 *   inspectorId, userId, isCompleted, isOpened, page, limit
 */
async function listTransactions(req, res) {
  try {
    const {
      companyId,
      inspectorId,
      userId,
      memberOfUserId,
      isCompleted,
      isOpened,
      page = 1,
      limit = 20,
    } = req.query;

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(100, Math.max(1, Number(limit) || 20));
    const skip = (pageNum - 1) * limitNum;

    const filter = {};

    if (memberOfUserId) {
      const companyIds = await resolveCompanyIdsForUser(
        String(memberOfUserId).trim(),
      );
      if (companyIds.length === 0) {
        return res.json({
          success: true,
          page: pageNum,
          limit: limitNum,
          total: 0,
          items: [],
        });
      }
      filter.companyId = { $in: companyIds };
    } else if (companyId) {
      filter.companyId = String(companyId).trim();
    }

    if (inspectorId) filter.assignedInspectorIds = String(inspectorId).trim();
    if (userId) filter.createdByUserId = String(userId).trim();
    if (isCompleted === "true") filter.isCompleted = true;
    if (isCompleted === "false") filter.isCompleted = false;
    if (isOpened === "true") filter.isOpened = true;
    if (isOpened === "false") filter.isOpened = false;

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

    const { item, warnings } = serializeTransactionForFiller(
      doc,
      client,
      region,
      city,
    );

    return res.json({
      success: true,
      item,
      ...(warnings.length > 0 && { warnings }),
    });
  } catch (err) {
    console.error("getTransaction error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

/**
 * POST /api/transactions/bulk-get
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
      return res.json({ success: true, items: [], warnings: [] });
    }

    const docs = await Transaction.find({ _id: { $in: validIds } }).lean();

    const [clientsById, regionsById, citiesById] = await Promise.all([
      fetchClientsByIds(docs.map((d) => d.clientId)),
      fetchRegionsByIds(docs.map((d) => d.evalData?.regionId)),
      fetchCitiesByIds(docs.map((d) => d.evalData?.cityId)),
    ]);

    const items = [];
    const warnings = [];

    for (const doc of docs) {
      const evalData = doc.evalData ?? {};
      const serialized = serializeTransactionForFiller(
        doc,
        doc.clientId ? clientsById.get(String(doc.clientId)) : null,
        evalData.regionId ? regionsById.get(String(evalData.regionId)) : null,
        evalData.cityId ? citiesById.get(String(evalData.cityId)) : null,
      );

      items.push(serialized.item);
      if (serialized.warnings.length > 0) {
        warnings.push(...serialized.warnings);
      }
    }

    return res.json({
      success: true,
      items,
      ...(warnings.length > 0 && { warnings }),
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
  return map;
}

async function fetchRegionsByIds(regionIds) {
  const uniqueIds = [...new Set((regionIds || []).filter(Boolean))];
  if (uniqueIds.length === 0) return new Map();

  const validIds = uniqueIds.filter((id) =>
    mongoose.Types.ObjectId.isValid(id),
  );
  if (validIds.length === 0) return new Map();

  const regions = await Region.find({ _id: { $in: validIds } })
    .select({ taqeemId: 1, taqeemName: 1 })
    .lean();

  const map = new Map();
  for (const r of regions) {
    map.set(r._id.toString(), {
      taqeemId: r.taqeemId ?? null,
      taqeemName: r.taqeemName ?? null,
    });
  }
  return map;
}

async function fetchCitiesByIds(cityIds) {
  const uniqueIds = [...new Set((cityIds || []).filter(Boolean))];
  if (uniqueIds.length === 0) return new Map();

  const validIds = uniqueIds.filter((id) =>
    mongoose.Types.ObjectId.isValid(id),
  );
  if (validIds.length === 0) return new Map();

  const cities = await City.find({ _id: { $in: validIds } })
    .select({ taqeemId: 1, taqeemName: 1 })
    .lean();

  const map = new Map();
  for (const c of cities) {
    map.set(c._id.toString(), {
      taqeemId: c.taqeemId ?? null,
      taqeemName: c.taqeemName ?? null,
    });
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

function buildFillerValues(doc, client, region, city) {
  const evalData = doc.evalData ?? {};
  const buildingCondition = evalData.buildingCondition ?? {};

  const warnings = [];

  // Resolve region name
  let regionName = region?.taqeemName ? String(region.taqeemName).trim() : null;
  if (!regionName) {
    regionName = "الرياض";
    warnings.push(
      `Default regionName 'الرياض' used for transaction ID ${doc._id}`,
    );
  }

  // Resolve city name
  let cityName = city?.taqeemName ? String(city.taqeemName).trim() : null;
  if (!cityName) {
    cityName = "الرياض";
    warnings.push(
      `Default cityName 'الرياض' used for transaction ID ${doc._id}`,
    );
  }

  const values = {
    // ── Step 1 ─────────────────────────────────────────────
    report_title: doc.assignmentNumber ?? "0",
    valuationPurpose: doc.valuationPurpose ?? null,
    valuationHypothesis: doc.valuationHypothesis ?? null,
    valuationBasis: doc.valuationBasis ?? null,
    report_type: null,
    evalDate: evalData.evalDate ?? null,
    reportDate: evalData.reportDate ?? null,
    assumptions: evalData.assumptions ?? null,
    special_assumptions: null,
    finalAssetValue: evalData.finalAssetValue ?? null,
    valuation_currency: null,
    report_asset_file: null,
    clientName: client?.name ?? evalData.clientName ?? null,
    contactNo: client?.phone ?? evalData.contactNo ?? null,
    email_address: client?.email ?? null,
    otherUsers: evalData.otherUsers ?? null,
    valuer_name: evalData.author1Id ?? null,
    contribution_percentage: null,

    // ── Step 2 ─────────────────────────────────────────────
    propertyType: evalData.propertyType ?? null,
    inspected_at: evalData.evalDate ?? null,
    marketMethodTotal: evalData.marketMethodTotal ?? null,
    marketMeterPrice: evalData.marketMeterPrice ?? null,
    incomeTotal: evalData.incomeTotal ?? null,
    incomeReason: evalData.incomeReason ?? null,
    costLandBuildTotal: evalData.costLandBuildTotal ?? null,
    costReason: evalData.costReason ?? null,
    lng: evalData.lng ?? null,
    lat: evalData.lat ?? null,
    landUse: evalData.landUse ?? null,
    country: null,
    regionName,
    cityName,
    regionTaqeemId: region?.taqeemId ?? null,
    cityTaqeemId: city?.taqeemId ?? null,

    // ── Step 3 ─────────────────────────────────────────────
    blockNumber: evalData.blockNumber ?? null,
    parcelNumber: evalData.parcelNumber ?? null,
    deedNumber: evalData.deedNumber ?? null,
    ownershipType: doc.ownershipType ?? null,
    ownershipPercentage: evalData.ownershipPercentage ?? null,
    rental_duration: null,
    rental_end_date: null,
    street_facing_fronts: null,
    distance_from_city_center: null,
    surroundingEnvironment: evalData.surroundingEnvironment ?? null,
    landSpace: evalData.landSpace ?? null,
    propertyArea: evalData.propertyArea ?? null,
    authorized_land_cover_percentage: null,
    authorized_height: null,
    land_leased: null,
    buildingCondition: buildingCondition.status ?? null,
    finishLevel: evalData.finishLevel ?? null,
    furnishing_status: null,
    air_conditioning: null,
    propertyModel: evalData.propertyModel ?? null,
    availableServices: evalData.availableServices ?? null,
    propertyAge: evalData.propertyAge ?? null,
    street: evalData.street ?? null,
  };

  return { values, warnings };
}

function serializeTransactionForFiller(doc, client, region, city) {
  const evalData = doc.evalData ?? {};
  const { values, warnings } = buildFillerValues(doc, client, region, city);

  return {
    item: {
      id: doc._id.toString(),
      _id: doc._id.toString(),
      ...values,
      valuers: buildValuers(evalData),
      evalData,
      reportId: doc.reportId ?? null,
      isOpened: doc.isOpened ?? false,
      isCompleted: doc.isCompleted ?? false,
      submitState: doc.submitState ?? 0,
    },
    warnings,
  };
}

module.exports = {
  listTransactions,
  getTransaction,
  bulkGetTransactions,
  setReportId,
};
