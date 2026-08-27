const Companes = require("../../infrastructure/models/companes");
const { normalizeOfficeId } = require("../utils/companyOffice");
const { normalizeCompanies } = require("../utils/taqeemUser");

const normalizeType = (value = "") => {
  const text = String(value || "").toLowerCase();
  if (text.includes("real")) return "real-estate";
  return "equipment";
};

// Spark Vision auth is cookie-based (no JWT), so there is no `req.user` set
// by any middleware anymore. The renderer explicitly sends the logged-in
// Spark Vision user's id in the body/query instead.
const resolveUserId = (req = {}) => {
  return req.body?.userId || req.query?.userId || null;
};

// Upserts each incoming company as its own Companes document, keyed by the
// Spark Vision userId. `user` is stored as a bare ObjectId reference —
// Mongoose does not validate that a User document with that id actually
// exists (that only happens on `.populate()`), so this works even though
// there is no local User collection under Spark Vision auth.
const upsertCompanies = async (userId, companies = []) => {
  if (!userId || !Array.isArray(companies) || companies.length === 0) {
    return [];
  }

  const results = await Promise.all(
    companies.map((company) => {
      const officeId = normalizeOfficeId(
        company.officeId ?? company.office_id ?? null,
      );
      const type = normalizeType(company.type);
      const payload = {
        name: company.name || "Unknown company",
        type,
        user: userId,
        url: company.url || "",
        sectorId: company.sectorId || null,
        valuers: Array.isArray(company.valuers) ? company.valuers : [],
      };

      if (officeId) {
        payload.officeId = officeId;
      }

      const filter = officeId
        ? { user: userId, type, officeId }
        : { user: userId, type, name: payload.name };

      return Companes.findOneAndUpdate(
        filter,
        { $set: payload },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      ).lean();
    }),
  );

  return results;
};

exports.syncCompanies = async (req, res) => {
  try {
    const userId = resolveUserId(req);
    const incomingCompanies = normalizeCompanies(req.body?.companies || []);

    if (!userId) {
      return res
        .status(400)
        .json({ message: "User id is required to store companies" });
    }
    if (!incomingCompanies.length) {
      return res.status(400).json({ message: "No companies provided" });
    }

    const saved = await upsertCompanies(userId, incomingCompanies);

    // defaultCompanyOfficeId used to live on the (now-gone) User document.
    // If the caller wants a default set, honor it by echoing back whichever
    // requested office actually got saved; otherwise fall back to the first
    // saved company with an officeId. This is stateless — Spark Vision has
    // no field to persist this preference in server-side, so the renderer
    // is responsible for remembering it (e.g. via its own local storage).
    const requestedDefaultOfficeId = normalizeOfficeId(
      req.body?.defaultCompanyOfficeId ||
        req.body?.selectedCompanyOfficeId ||
        req.body?.companyOfficeId ||
        null,
    );
    const matchedDefault = requestedDefaultOfficeId
      ? saved.find((c) => c.officeId === requestedDefaultOfficeId)
      : null;
    const defaultCompanyOfficeId =
      matchedDefault?.officeId ||
      saved.find((c) => c.officeId)?.officeId ||
      null;

    return res.status(200).json({
      status: "SUCCESS",
      data: saved,
      meta: {
        defaultCompanyOfficeId,
      },
    });
  } catch (err) {
    console.error("Failed to sync companies", err);
    return res
      .status(500)
      .json({ message: "Server error", error: err.message });
  }
};

exports.listMyCompanies = async (req, res) => {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(400).json({ message: "User id is required" });
    }

    const { type } = req.query;
    const normalizedType = type ? normalizeType(type) : null;

    const filter = { user: userId };
    if (normalizedType) {
      filter.type = normalizedType;
    }

    const items = await Companes.find(filter).sort({ createdAt: -1 }).lean();

    const defaultCompanyOfficeId = items.find((c) => c.officeId)?.officeId || null;

    return res.status(200).json({
      status: "SUCCESS",
      data: items,
      meta: {
        defaultCompanyOfficeId,
      },
    });
  } catch (err) {
    console.error("Failed to fetch companies", err);
    return res
      .status(500)
      .json({ message: "Server error", error: err.message });
  }
};
