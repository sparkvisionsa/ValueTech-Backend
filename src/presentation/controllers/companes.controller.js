const User = require('../../infrastructure/models/user');
const Companes = require('../../infrastructure/models/companes');
const { normalizeOfficeId } = require('../utils/companyOffice');
const {
    normalizeCompanies,
    mergeCompanies,
    normalizeTaqeemUsername,
    resolveDefaultCompanyOfficeId,
} = require('../utils/taqeemUser');

const normalizeType = (value = '') => {
    const text = String(value || '').toLowerCase();
    if (text.includes('real')) return 'real-estate';
    return 'equipment';
};

const resolveUserId = (req = {}) => {
    return (
        req.user?.id ||
        req.user?._id ||
        req.body?.userId ||
        req.query?.userId ||
        null
    );
};

const ensureTaqeemState = (user) => {
    if (!user.taqeem || typeof user.taqeem !== 'object') {
        user.taqeem = {
            username: '',
            companies: [],
        };
    }

    if (!Array.isArray(user.taqeem.companies)) {
        user.taqeem.companies = [];
    }
};

const upsertLegacyCompanes = async (user, companies = []) => {
    if (!user?._id || !Array.isArray(companies) || companies.length === 0) return;

    await Promise.all(
        companies.map((company) => {
            const officeId = normalizeOfficeId(company.officeId ?? company.office_id ?? null);
            const payload = {
                name: company.name || 'Unknown company',
                type: normalizeType(company.type),
                phone: user.phone || null,
                user: user._id,
                url: company.url || '',
                sectorId: company.sectorId || null,
                valuers: Array.isArray(company.valuers) ? company.valuers : [],
            };

            if (officeId) {
                payload.officeId = officeId;
            }

            const filter = officeId
                ? { user: user._id, type: payload.type, officeId }
                : { user: user._id, type: payload.type, name: payload.name };

            return Companes.findOneAndUpdate(
                filter,
                { $set: payload },
                { new: true, upsert: true, setDefaultsOnInsert: true },
            ).lean();
        }),
    );
};

exports.syncCompanies = async (req, res) => {
    try {
        const userId = resolveUserId(req);
        const incomingCompanies = normalizeCompanies(req.body?.companies || []);

        if (!userId) {
            return res.status(400).json({ message: 'User id is required to store companies' });
        }
        if (!incomingCompanies.length) {
            return res.status(400).json({ message: 'No companies provided' });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        ensureTaqeemState(user);

        const taqeemUser = normalizeTaqeemUsername(
            req.body?.taqeemUser || req.body?.username || user?.taqeem?.username,
        );

        if (taqeemUser) {
            user.taqeem.username = taqeemUser;
        }

        user.taqeem.companies = mergeCompanies(user.taqeem.companies || [], incomingCompanies);

        const requestedDefaultOfficeId = normalizeOfficeId(
            req.body?.defaultCompanyOfficeId ||
                req.body?.selectedCompanyOfficeId ||
                req.body?.companyOfficeId ||
                null,
        );

        const defaultOfficeId = resolveDefaultCompanyOfficeId(
            requestedDefaultOfficeId,
            user.taqeem.companies,
        );

        if (defaultOfficeId) {
            user.taqeem.defaultCompanyOfficeId = defaultOfficeId;
            if (!user.taqeem.firstCompanySelectedAt) {
                user.taqeem.firstCompanySelectedAt = new Date();
            }
        }

        user.taqeem.lastSyncedAt = new Date();
        await user.save();

        await upsertLegacyCompanes(user, incomingCompanies).catch((err) => {
            console.warn('[companes.sync] Failed to sync legacy companes collection:', err?.message || err);
        });

        return res.status(200).json({
            status: 'SUCCESS',
            data: user.taqeem.companies,
            meta: {
                defaultCompanyOfficeId: user.taqeem.defaultCompanyOfficeId || null,
                taqeemUser: user.taqeem.username || null,
            },
        });
    } catch (err) {
        console.error('Failed to sync companies', err);
        return res.status(500).json({ message: 'Server error', error: err.message });
    }
};

exports.listMyCompanies = async (req, res) => {
    try {
        const userId = resolveUserId(req);
        if (!userId) {
            return res.status(400).json({ message: 'User id is required' });
        }

        const { type } = req.query;
        const normalizedType = type ? normalizeType(type) : null;

        const user = await User.findById(userId).lean();
        const taqeemCompanies = Array.isArray(user?.taqeem?.companies)
            ? user.taqeem.companies
            : [];

        if (taqeemCompanies.length > 0) {
            const filtered = normalizedType
                ? taqeemCompanies.filter((item) => normalizeType(item.type) === normalizedType)
                : taqeemCompanies;

            return res.status(200).json({
                status: 'SUCCESS',
                data: filtered,
                meta: {
                    defaultCompanyOfficeId: user?.taqeem?.defaultCompanyOfficeId || null,
                    taqeemUser: user?.taqeem?.username || null,
                },
            });
        }

        const legacyFilter = { user: userId };
        if (normalizedType) {
            legacyFilter.type = normalizedType;
        }

        const legacyItems = await Companes.find(legacyFilter).sort({ createdAt: -1 }).lean();

        return res.status(200).json({
            status: 'SUCCESS',
            data: legacyItems,
            meta: {
                defaultCompanyOfficeId: null,
                taqeemUser: user?.taqeem?.username || null,
                source: 'legacy-companes',
            },
        });
    } catch (err) {
        console.error('Failed to fetch companies', err);
        return res.status(500).json({ message: 'Server error', error: err.message });
    }
};
