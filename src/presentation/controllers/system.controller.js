const SystemState = require('../../infrastructure/models/systemState');
const User = require('../../infrastructure/models/user');
const Company = require('../../infrastructure/models/company');
const PackageModel = require('../../infrastructure/models/package');
const Subscription = require('../../infrastructure/models/subscription');
const SystemUpdate = require('../../infrastructure/models/systemUpdate');
const Report = require('../../infrastructure/models/report');
const UrgentReport = require('../../infrastructure/models/UrgentReport');
const DuplicateReport = require('../../infrastructure/models/DuplicateReport');
const MultiApproachReport = require('../../infrastructure/models/MultiApproachReport');
const ElrajhiReport = require('../../infrastructure/models/ElrajhiReport');

const VALID_MODES = ['active', 'inactive', 'partial', 'demo'];

const buildLast7Days = () => {
    const labels = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 6; i >= 0; i -= 1) {
        const day = new Date(today);
        day.setDate(today.getDate() - i);
        labels.push(day.toISOString().slice(0, 10));
    }
    return labels;
};

const aggregateDailyCounts = async (Model, startDate) => {
    if (!Model) return {};
    const rows = await Model.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        {
            $group: {
                _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                count: { $sum: 1 }
            }
        }
    ]);
    return rows.reduce((acc, row) => {
        acc[row._id] = row.count;
        return acc;
    }, {});
};

const mergeDailyCounts = (target, source) => {
    Object.entries(source || {}).forEach(([key, value]) => {
        target[key] = (target[key] || 0) + value;
    });
    return target;
};

exports.getSystemState = async (req, res) => {
    try {
        const state = await SystemState.getSingleton();
        res.json(state);
    } catch (error) {
        res.status(500).json({ message: 'Failed to load system state', error: error.message });
    }
};

exports.updateSystemState = async (req, res) => {
    const {
        mode,
        expectedReturn,
        downtimeDays,
        downtimeHours,
        notes,
        allowedModules,
        partialMessage,
        guestAccessEnabled,
        guestAccessLimit,
        ramTabsPerGb
    } = req.body;
    try {
        if (mode && !VALID_MODES.includes(mode)) {
            return res.status(400).json({ message: 'Invalid mode supplied' });
        }

        const state = await SystemState.getSingleton();

        if (mode) state.mode = mode;
        if (typeof downtimeDays === 'number' || typeof downtimeDays === 'string') {
            const parsed = Number(downtimeDays);
            if (Number.isNaN(parsed) || parsed < 0) {
                return res.status(400).json({ message: 'downtimeDays must be a positive number' });
            }
            state.downtimeDays = parsed;
        }

        if (typeof downtimeHours === 'number' || typeof downtimeHours === 'string') {
            const parsed = Number(downtimeHours);
            if (Number.isNaN(parsed) || parsed < 0) {
                return res.status(400).json({ message: 'downtimeHours must be a positive number' });
            }
            state.downtimeHours = parsed;
        }
        state.notes = typeof notes === 'string' ? notes : state.notes;
        state.partialMessage = typeof partialMessage === 'string' ? partialMessage : state.partialMessage;

        if (expectedReturn === null) {
            state.expectedReturn = null;
        } else if (expectedReturn) {
            const asDate = new Date(expectedReturn);
            if (Number.isNaN(asDate.getTime())) {
                return res.status(400).json({ message: 'expectedReturn must be a valid date' });
            }
            state.expectedReturn = asDate;
        }

        if (Array.isArray(allowedModules) && (mode === 'partial' || mode === 'demo')) {
            state.allowedModules = allowedModules.filter(Boolean);
        } else if (mode && mode !== 'partial' && mode !== 'demo') {
            state.allowedModules = [];
        }

        if (typeof guestAccessEnabled === 'boolean') {
            state.guestAccessEnabled = guestAccessEnabled;
        }

        if (typeof guestAccessLimit === 'number' || typeof guestAccessLimit === 'string') {
            const parsed = Number(guestAccessLimit);
            if (Number.isNaN(parsed) || parsed < 1) {
                return res.status(400).json({ message: 'guestAccessLimit must be a number greater than 0' });
            }
            state.guestAccessLimit = parsed;
        }

        if (typeof ramTabsPerGb === 'number' || typeof ramTabsPerGb === 'string') {
            const parsed = Number(ramTabsPerGb);
            if (Number.isNaN(parsed) || parsed <= 0) {
                return res.status(400).json({ message: 'ramTabsPerGb must be a number greater than 0' });
            }
            state.ramTabsPerGb = parsed;
        }

        state.updatedBy = req.userId || state.updatedBy;
        state.updatedByPhone = req.user?.phone || state.updatedByPhone;
        state.updatedAt = new Date();
        await state.save();

        res.json(state);
    } catch (error) {
        res.status(500).json({ message: 'Failed to update system state', error: error.message });
    }
};

exports.getSystemStats = async (req, res) => {
    try {
        const [
            userCount,
            companyCount,
            packageCount,
            subscriptionCount,
            updateCount,
            reportCount,
            urgentCount,
            duplicateCount,
            multiApproachCount,
            elrajhiCount
        ] = await Promise.all([
            User.countDocuments(),
            Company.countDocuments(),
            PackageModel.countDocuments(),
            Subscription.countDocuments(),
            SystemUpdate.countDocuments(),
            Report.countDocuments(),
            UrgentReport.countDocuments(),
            DuplicateReport.countDocuments(),
            MultiApproachReport.countDocuments(),
            ElrajhiReport.countDocuments()
        ]);

        const reportTypes = {
            standard: reportCount,
            urgent: urgentCount,
            duplicate: duplicateCount,
            multiApproach: multiApproachCount,
            elrajhi: elrajhiCount
        };

        const totals = {
            users: userCount,
            companies: companyCount,
            packages: packageCount,
            subscriptions: subscriptionCount,
            updates: updateCount,
            reports: Object.values(reportTypes).reduce((sum, value) => sum + value, 0)
        };

        const start = new Date();
        start.setHours(0, 0, 0, 0);
        start.setDate(start.getDate() - 6);

        const [
            userDaily,
            standardDaily,
            urgentDaily,
            duplicateDaily,
            multiApproachDaily,
            elrajhiDaily
        ] = await Promise.all([
            aggregateDailyCounts(User, start),
            aggregateDailyCounts(Report, start),
            aggregateDailyCounts(UrgentReport, start),
            aggregateDailyCounts(DuplicateReport, start),
            aggregateDailyCounts(MultiApproachReport, start),
            aggregateDailyCounts(ElrajhiReport, start)
        ]);

        const reportDaily = mergeDailyCounts(
            mergeDailyCounts(
                mergeDailyCounts(
                    mergeDailyCounts(
                        mergeDailyCounts({}, standardDaily),
                        urgentDaily
                    ),
                    duplicateDaily
                ),
                multiApproachDaily
            ),
            elrajhiDaily
        );

        const labels = buildLast7Days();
        const weekly = {
            labels,
            users: labels.map((label) => userDaily[label] || 0),
            reports: labels.map((label) => reportDaily[label] || 0)
        };

        const statusRows = await UrgentReport.aggregate([
            { $group: { _id: '$report_status', count: { $sum: 1 } } }
        ]);
        const reportStatus = {
            incomplete: 0,
            complete: 0,
            sent: 0,
            confirmed: 0
        };
        statusRows.forEach((row) => {
            const key = String(row._id || '').toLowerCase();
            if (key === 'incomplete') reportStatus.incomplete = row.count;
            if (key === 'complete') reportStatus.complete = row.count;
            if (key === 'sent') reportStatus.sent = row.count;
            if (key === 'confirmed') reportStatus.confirmed = row.count;
        });

        const recentUpdates = await SystemUpdate.find()
            .sort({ createdAt: -1 })
            .limit(4)
            .select('version updateType status createdAt');

        res.json({
            generatedAt: new Date().toISOString(),
            totals,
            reportTypes,
            reportStatus,
            weekly,
            recentUpdates
        });
    } catch (error) {
        res.status(500).json({ message: 'Failed to load system stats', error: error.message });
    }
};
