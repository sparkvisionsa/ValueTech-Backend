const { normalizeOfficeId } = require('./companyOffice');

const safeString = (value) => {
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

const normalizeTaqeemUsername = (value) => {
  const normalized = safeString(value);
  return normalized || null;
};

const normalizeValuers = (input = []) => {
  if (!Array.isArray(input)) return [];

  const seen = new Set();
  const valuers = [];

  for (const item of input) {
    const valuerId = safeString(
      item?.valuerId ?? item?.valuer_id ?? item?.id ?? item?.value,
    );
    const valuerName = safeString(
      item?.valuerName ?? item?.valuer_name ?? item?.name ?? item?.label,
    );

    if (!valuerId && !valuerName) continue;

    const key = (valuerId || valuerName).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    valuers.push({
      valuerId: valuerId || null,
      valuerName: valuerName || null,
    });
  }

  return valuers;
};

const normalizeCompanyType = (value = '') => {
  const text = safeString(value).toLowerCase();
  if (text.includes('real')) return 'real-estate';
  if (text.includes('estate')) return 'real-estate';
  return 'equipment';
};

const INTERNAL_VALUERS_FLAG = '__valuersProvided';
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);

const stripInternalCompanyFields = (company = {}) => {
  const cleaned = { ...company };
  delete cleaned[INTERNAL_VALUERS_FLAG];
  cleaned.valuers = normalizeValuers(cleaned.valuers);
  return cleaned;
};

const getCompanyKey = (company = {}) => {
  const officeId = normalizeOfficeId(company.officeId ?? company.office_id ?? company.id);
  if (officeId) return `office:${officeId}`;

  const url = safeString(company.url || company.link);
  if (url) return `url:${url.toLowerCase()}`;

  const name = safeString(company.name || company.companyName);
  if (name) return `name:${name.toLowerCase()}`;

  return null;
};

const normalizeCompany = (company = {}) => {
  const officeId = normalizeOfficeId(
    company.officeId ?? company.office_id ?? company.id ?? null,
  );
  const sectorId = safeString(company.sectorId ?? company.sector_id);
  const name = safeString(company.name || company.companyName || company.label);
  const url = safeString(company.url || company.link);
  const hasValuersProvided = hasOwn(company, INTERNAL_VALUERS_FLAG)
    ? Boolean(company[INTERNAL_VALUERS_FLAG])
    : hasOwn(company, 'valuers');

  return {
    officeId,
    sectorId: sectorId || null,
    name: name || 'Unknown company',
    url: url || null,
    type: normalizeCompanyType(company.type),
    valuers: hasValuersProvided ? normalizeValuers(company.valuers) : [],
    [INTERNAL_VALUERS_FLAG]: hasValuersProvided,
  };
};

const normalizeCompaniesInternal = (companies = []) => {
  if (!Array.isArray(companies)) return [];

  const map = new Map();
  for (const company of companies) {
    const normalized = normalizeCompany(company);
    const key = getCompanyKey(normalized);
    if (!key) continue;

    if (!map.has(key)) {
      map.set(key, normalized);
      continue;
    }

    const existing = map.get(key);
    const existingHasValuers = Boolean(existing?.[INTERNAL_VALUERS_FLAG]);
    const incomingHasValuers = Boolean(normalized?.[INTERNAL_VALUERS_FLAG]);
    let mergedValuers = normalizeValuers(existing?.valuers || []);

    if (existingHasValuers && incomingHasValuers) {
      // Within the same payload, combine duplicates for the same office/url/name.
      mergedValuers = normalizeValuers([
        ...(existing.valuers || []),
        ...(normalized.valuers || []),
      ]);
    } else if (incomingHasValuers) {
      mergedValuers = normalizeValuers(normalized.valuers || []);
    }

    map.set(key, {
      ...existing,
      ...normalized,
      officeId: existing.officeId || normalized.officeId,
      sectorId: existing.sectorId || normalized.sectorId,
      url: existing.url || normalized.url,
      type: existing.type || normalized.type,
      valuers: mergedValuers,
      [INTERNAL_VALUERS_FLAG]: existingHasValuers || incomingHasValuers,
    });
  }

  return Array.from(map.values());
};

const normalizeCompanies = (companies = []) =>
  normalizeCompaniesInternal(companies).map(stripInternalCompanyFields);

const normalizeProfile = (profile = {}) => {
  if (!profile || typeof profile !== 'object') return null;

  const fields = profile.fields && typeof profile.fields === 'object'
    ? Object.fromEntries(
      Object.entries(profile.fields)
        .map(([k, v]) => [safeString(k), safeString(v)])
        .filter(([k, v]) => k && v),
    )
    : {};

  const normalized = {
    taqeemUser: normalizeTaqeemUsername(
      profile.taqeemUser ?? profile.username ?? profile.user_id ?? profile.userId,
    ),
    fullName: safeString(profile.fullName ?? profile.name ?? profile.full_name) || null,
    email: safeString(profile.email) || null,
    phone: safeString(profile.phone ?? profile.mobile ?? profile.phoneNumber) || null,
    nationalId: safeString(
      profile.nationalId ?? profile.national_id ?? profile.identityNumber,
    ) || null,
    licenseNumber: safeString(
      profile.licenseNumber ?? profile.membershipNumber ?? profile.valuerLicense,
    ) || null,
    fields,
    raw: profile.raw && typeof profile.raw === 'object' ? profile.raw : null,
  };

  return normalized;
};

const extractTaqeemUsernameFromProfile = (profile = null) => {
  const normalized = normalizeProfile(profile);
  return normalizeTaqeemUsername(normalized?.taqeemUser);
};

const mergeUniqueStringList = (...lists) => {
  const seen = new Set();
  const out = [];

  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const value = safeString(item);
      if (!value) continue;
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(value);
    }
  }

  return out;
};

const mergePhones = (currentPhones = [], phone = null) => {
  const normalizedPhone = safeString(phone);
  if (!normalizedPhone) return mergeUniqueStringList(currentPhones);
  return mergeUniqueStringList(currentPhones, [normalizedPhone]);
};

const mergeCompanyRecord = (existing = {}, incoming = {}) => {
  const incomingHasValuers = Boolean(incoming?.[INTERNAL_VALUERS_FLAG]);
  const mergedValuers = incomingHasValuers
    ? normalizeValuers(incoming?.valuers || [])
    : normalizeValuers(existing?.valuers || []);

  const merged = {
    officeId: normalizeOfficeId(existing.officeId ?? incoming.officeId),
    sectorId: safeString(existing.sectorId || incoming.sectorId) || null,
    name: safeString(existing.name || incoming.name) || 'Unknown company',
    url: safeString(existing.url || incoming.url) || null,
    type: normalizeCompanyType(existing.type || incoming.type),
    valuers: mergedValuers,
    [INTERNAL_VALUERS_FLAG]:
      Boolean(existing?.[INTERNAL_VALUERS_FLAG]) || incomingHasValuers,
  };

  return merged;
};

const mergeCompanies = (existingCompanies = [], incomingCompanies = []) => {
  const map = new Map();

  for (const company of normalizeCompaniesInternal(existingCompanies)) {
    const key = getCompanyKey(company);
    if (!key) continue;
    map.set(key, company);
  }

  for (const company of normalizeCompaniesInternal(incomingCompanies)) {
    const key = getCompanyKey(company);
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, company);
      continue;
    }
    map.set(key, mergeCompanyRecord(map.get(key), company));
  }

  return Array.from(map.values()).map(stripInternalCompanyFields);
};

const resolveDefaultCompanyOfficeId = (officeId, companies = []) => {
  const normalized = normalizeOfficeId(officeId);
  if (!normalized) return null;

  const exists = (companies || []).some((company) => {
    const companyOfficeId = normalizeOfficeId(company?.officeId ?? company?.office_id);
    return companyOfficeId === normalized;
  });

  return exists ? normalized : null;
};

module.exports = {
  safeString,
  normalizeTaqeemUsername,
  normalizeValuers,
  normalizeCompanyType,
  normalizeCompany,
  normalizeCompanies,
  normalizeProfile,
  extractTaqeemUsernameFromProfile,
  mergePhones,
  mergeCompanies,
  resolveDefaultCompanyOfficeId,
  getCompanyKey,
};
