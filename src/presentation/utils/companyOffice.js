const normalizeOfficeId = (value) => {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
};

const extractCompanyOfficeId = (req = {}) => {
  const body = req.body || {};
  const query = req.query || {};
  const headers = req.headers || {};

  const fromBody =
    body.companyOfficeId ??
    body.company_office_id ??
    body.officeId ??
    body.office_id;
  const fromQuery =
    query.companyOfficeId ??
    query.company_office_id ??
    query.officeId ??
    query.office_id;
  const fromHeaders =
    headers["x-company-office-id"] ??
    headers["x-office-id"];

  return normalizeOfficeId(fromBody ?? fromQuery ?? fromHeaders);
};

module.exports = {
  extractCompanyOfficeId,
  normalizeOfficeId,
};
