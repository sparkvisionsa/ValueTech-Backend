const Companes = require('../../infrastructure/models/companes');

const normalizeType = (t = '') => {
    const val = String(t || '').toLowerCase();
    if (val.includes('real')) return 'real-estate';
    if (val.includes('equip')) return 'equipment';
    return 'equipment';
};

const normalizeOfficeId = (value) => {
    if (value === undefined || value === null) return null;
    const trimmed = String(value || '').trim();
    return trimmed || null;
};

const normalizeValuers = (list = []) => {
    if (!Array.isArray(list)) return [];
    return list
        .map((valuer) => ({
            valuerId: (valuer?.valuerId || valuer?.valuer_id || valuer?.id || '').toString().trim(),
            valuerName: (valuer?.valuerName || valuer?.valuer_name || valuer?.name || valuer?.label || '').toString().trim(),
        }))
        .filter((v) => v.valuerId || v.valuerName);
};

exports.syncCompanies = async (req, res) => {
    try {
        const phone = req.user?.phone || req.body?.phone;
        const userId = req.user?.id || req.user?._id || null;
        const companies = Array.isArray(req.body?.companies) ? req.body.companies : [];

        if (!phone) {
            return res.status(400).json({ message: 'User phone is required to store companies' });
        }
        if (!companies.length) {
            return res.status(400).json({ message: 'No companies provided' });
        }

        const upserts = await Promise.all(
            companies.map((company) => {
                const officeId = normalizeOfficeId(
                    company.officeId ?? company.office_id ?? null
                );
                const payload = {
                    name: company.name || company.companyName || 'Unknown company',
                    type: normalizeType(company.type),
                    phone,
                    user: userId,
                    url: company.url || company.link || '',
                    sectorId: company.sectorId || company.sector_id || null
                };

                if (officeId) {
                    payload.officeId = officeId;
                }

                if (Array.isArray(company.valuers)) {
                    payload.valuers = normalizeValuers(company.valuers);
                }

                const filter = {
                    phone,
                    type: payload.type
                };
                if (officeId) {
                    filter.officeId = officeId;
                } else {
                    filter.name = payload.name;
                }

                return Companes.findOneAndUpdate(
                    filter,
                    { $set: payload },
                    { new: true, upsert: true, setDefaultsOnInsert: true }
                ).lean();
            })
        );

        return res.status(200).json({
            status: 'SUCCESS',
            data: upserts
        });
    } catch (err) {
        console.error('Failed to sync companies', err);
        return res.status(500).json({ message: 'Server error', error: err.message });
    }
};

exports.listMyCompanies = async (req, res) => {
    try {
        const phone = req.user?.phone || req.query?.phone;
        if (!phone) {
            return res.status(400).json({ message: 'User phone is required' });
        }

        const { type } = req.query;
        const filter = { phone };
        if (type) {
            filter.type = normalizeType(type);
        }

        const items = await Companes.find(filter).sort({ createdAt: -1 }).lean();
        return res.status(200).json({ status: 'SUCCESS', data: items });
    } catch (err) {
        console.error('Failed to fetch companies', err);
        return res.status(500).json({ message: 'Server error', error: err.message });
    }
};
