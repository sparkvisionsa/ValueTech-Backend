const mongoose = require('mongoose');
const Package = require('../../infrastructure/models/package');
const Subscription = require('../../infrastructure/models/subscription');
const PaymentRequest = require('../../infrastructure/models/paymentRequest');
const PaymentRequestMessage = require('../../infrastructure/models/paymentRequestMessage');
const User = require('../../infrastructure/models/user');
const StoredFile = require('../../infrastructure/models/storedFile');
const Report = require('../../infrastructure/models/report');
const MultiApproachReport = require('../../infrastructure/models/MultiApproachReport');
const DuplicateReport = require('../../infrastructure/models/DuplicateReport');
const SubmitReportsQuickly = require('../../infrastructure/models/SubmitReportsQuickly');
const ElrajhiReport = require('../../infrastructure/models/ElrajhiReport');
const PointDeduction = require('../../infrastructure/models/pointDeduction');
const deductPoints = require('../../application/services/packages/deductPoints');
const { createNotification } = require('../../application/services/notification/notification.service');
const { storeAttachments, storeUploadedFile, buildFileUrl } = require('../../application/services/files/fileStorage.service');

const ADMIN_PHONE = '000';
const PREVIEW_LIMIT = 140;
const REQUEST_POPULATE = [
    { path: 'userId', select: 'phone taqeem.username displayName' },
    { path: 'packageId', select: 'name points price' }
];

const getUserById = async (userId) => {
    if (!userId) return null;
    return User.findById(userId);
};

const isAdminUser = (user) => Boolean(user && user.phone === ADMIN_PHONE);

const buildPreview = (text = '') => {
    const trimmed = String(text || '').trim();
    if (trimmed.length <= PREVIEW_LIMIT) return trimmed;
    return `${trimmed.slice(0, PREVIEW_LIMIT)}...`;
};

const buildAttachments = async (files = [], ownerId = null) => {
    if (!Array.isArray(files) || files.length === 0) return [];
    return storeAttachments(files, { ownerId, purpose: 'request-message' });
};

const buildMessagePreview = (body = '', attachments = []) => {
    const trimmed = String(body || '').trim();
    if (trimmed) return buildPreview(trimmed);
    if (attachments.length === 1) return 'Attachment';
    if (attachments.length > 1) return `${attachments.length} attachments`;
    return '';
};

const DEFAULT_PAGE_NAME = 'Packages';
const DEFAULT_SOURCE_CONFIG = {
    model: Report,
    pageName: 'Packages',
    pageSource: 'packages',
    batchField: null,
};

const SOURCE_CONFIGS = {
    'upload-assets': {
        model: Report,
        pageName: 'Upload Assets',
        pageSource: 'upload-assets',
    },
    'reports-table': {
        model: Report,
        pageName: 'Reports Table',
        pageSource: 'reports-table',
    },
    'submit-reports-quickly': {
        model: SubmitReportsQuickly,
        pageName: 'Submit Reports Quickly',
        pageSource: 'submit-reports-quickly',
        batchField: 'batch_id',
    },
    'duplicate-report': {
        model: DuplicateReport,
        pageName: 'Upload Manual Report',
        pageSource: 'duplicate-report',
    },
    'multi-batch': {
        model: MultiApproachReport,
        pageName: 'Multi-Excel Upload',
        pageSource: 'multi-batch',
        batchField: 'batchId',
    },
    'manual-report': {
        model: MultiApproachReport,
        pageName: 'Manual Multi Report',
        pageSource: 'manual-report',
        batchField: 'batchId',
    },
    'elrajhi-upload': {
        model: ElrajhiReport,
        pageName: 'Upload Report (El Rajhi)',
        pageSource: 'elrajhi-upload',
        batchField: 'batchId',
    },
    'elrajhi-upload-pdf': {
        model: ElrajhiReport,
        pageName: 'Upload Report (El Rajhi) - PDF',
        pageSource: 'elrajhi-upload-pdf',
        batchField: 'batchId',
    },
    system: {
        model: ElrajhiReport,
        pageName: 'Upload Report (El Rajhi)',
        pageSource: 'system',
        batchField: 'batchId',
    },
};

const toDateValue = (value) => {
    if (!value) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value === 'string' || typeof value === 'number') {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    return null;
};

const inferAssetCount = (doc) => {
    if (!doc) return 0;
    const candidates = [
        doc.asset_data,
        doc.assetData,
        doc.assets,
        doc.assetList,
        doc.assets_data,
        doc.asset_list,
    ];

    for (const value of candidates) {
        if (Array.isArray(value)) return value.length;
        if (Number.isFinite(value)) {
            const normalized = Number(value);
            if (!Number.isNaN(normalized)) return Math.max(0, normalized);
        }
    }

    if (doc.asset_data && typeof doc.asset_data === 'object' && Array.isArray(doc.asset_data.assets)) {
        return doc.asset_data.assets.length;
    }

    return 0;
};

const getSourceConfig = (source) => {
    if (!source) return DEFAULT_SOURCE_CONFIG;
    const config = SOURCE_CONFIGS[source] || DEFAULT_SOURCE_CONFIG;
    return {
        ...DEFAULT_SOURCE_CONFIG,
        ...config,
    };
};

const buildUserFilter = (userId) => {
    if (!userId) return {};
    if (mongoose.Types.ObjectId.isValid(String(userId))) {
        return { user_id: new mongoose.Types.ObjectId(String(userId)) };
    }
    return { user_id: String(userId) };
};

const buildSummaryFromDoc = (doc, config, overrides = {}) => {
    if (!doc) return null;
    const reportIdentifier =
        doc.report_id ||
        doc.reportId ||
        doc.rawReportId ||
        doc.reportIdValue ||
        (doc._id ? doc._id.toString() : '');
    const resolvedPageName = overrides.pageName || config.pageName || DEFAULT_PAGE_NAME;
    const resolvedPageSource =
        overrides.pageSource || config.pageSource || DEFAULT_SOURCE_CONFIG.pageSource;
    return {
        reportId: reportIdentifier,
        recordId: doc._id ? doc._id.toString() : overrides.recordId || null,
        clientName: doc.client_name || doc.title || doc.clientName || '',
        submittedAt: toDateValue(doc.submitted_at || doc.submittedAt || null),
        endSubmitTime: toDateValue(doc.endSubmitTime || doc.end_submit_time || null),
        pageName: resolvedPageName,
        pageSource: resolvedPageSource,
        assetCount: inferAssetCount(doc),
    };
};

const collectReportSummaries = async (options = {}) => {
    const {
        source,
        userId,
        reportIds = [],
        reportId,
        recordId,
        batchId,
        pageName,
        pageSource,
    } = options;
    const config = getSourceConfig(source);
    const model = config.model;
    if (!model) return [];
    const baseFilter = buildUserFilter(userId);
    const seenIds = new Set();
    const summaries = [];

    const pushDoc = (doc) => {
        if (!doc || !doc._id) return;
        const key = doc._id.toString();
        if (seenIds.has(key)) return;
        seenIds.add(key);
        const summary = buildSummaryFromDoc(doc, config, { pageName, pageSource });
        if (summary) summaries.push(summary);
    };

    const queryAndPush = async (query) => {
        if (!query) return;
        const docs = await model.find({ ...baseFilter, ...query }).lean();
        docs.forEach(pushDoc);
    };

    const normalizedReportIds = Array.isArray(reportIds)
        ? reportIds.filter(Boolean)
        : [];
    if (normalizedReportIds.length) {
        await queryAndPush({ report_id: { $in: normalizedReportIds } });
    }
    if (reportId) {
        await queryAndPush({ report_id: reportId });
    }
    if (recordId) {
        await queryAndPush({ _id: recordId });
    }
    if (batchId && config.batchField) {
        await queryAndPush({ [config.batchField]: batchId });
    }

    if (!summaries.length && normalizedReportIds.length) {
        const fallback = normalizedReportIds[0];
        summaries.push({
            reportId: fallback,
            recordId: recordId || null,
            clientName: '',
            submittedAt: null,
            endSubmitTime: null,
            pageName: pageName || config.pageName || DEFAULT_PAGE_NAME,
            pageSource:
                pageSource || config.pageSource || source || DEFAULT_SOURCE_CONFIG.pageSource,
        });
    }
    if (!summaries.length && reportId) {
        summaries.push({
            reportId,
            recordId: recordId || null,
            clientName: '',
            submittedAt: null,
            endSubmitTime: null,
            pageName: pageName || config.pageName || DEFAULT_PAGE_NAME,
            pageSource:
                pageSource || config.pageSource || source || DEFAULT_SOURCE_CONFIG.pageSource,
        });
    }

    return summaries;
};

const createPointDeductionRecord = async (params) => {
    return PointDeduction.create(params);
};
const canAccessRequest = (request, userId, isAdmin) => {
    if (!request || !userId) return false;
    if (isAdmin) return true;
    return request.userId?.toString() === userId.toString();
};

const sanitizeLimit = (value, fallback = 50) => {
    const limit = Number(value);
    if (!Number.isFinite(limit) || limit <= 0) return fallback;
    return Math.min(limit, 200);
};

exports.getAllPackages = async (req, res) => {
    try {
        const packages = await Package.find();
        res.json(packages);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.addPackage = async (req, res) => {
    const { name, points, price } = req.body;
    if (!name || !points || !price || points <= 0 || price <= 0) {
        return res.status(400).json({ message: 'Invalid input' });
    }
    try {
        const newPackage = new Package({ name, points, price });
        await newPackage.save();
        res.status(201).json(newPackage);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.updatePackage = async (req, res) => {
    const { id } = req.params;
    const { name, points, price } = req.body;
    if (!name || !points || !price || points <= 0 || price <= 0) {
        return res.status(400).json({ message: 'Invalid input' });
    }
    try {
        const updatedPackage = await Package.findByIdAndUpdate(id, { name, points, price }, { new: true });
        if (!updatedPackage) {
            return res.status(404).json({ message: 'Package not found' });
        }
        res.json(updatedPackage);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.deletePackage = async (req, res) => {
    const { id } = req.params;
    try {
        const deletedPackage = await Package.findByIdAndDelete(id);
        if (!deletedPackage) {
            return res.status(404).json({ message: 'Package not found' });
        }
        res.json({ message: 'Package deleted' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.subscribeToPackage = async (req, res) => {
    const { packageId } = req.body;
    const userId = req.userId;

    try {
        const pkg = await Package.findById(packageId);
        if (!pkg) return res.status(404).json({ message: 'Package not found' });

        const subscription = new Subscription({
            userId,
            packageId,
            remainingPoints: pkg.points
        });

        await subscription.save();
        res.status(201).json(subscription);

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};


exports.getUserSubscriptions = async (req, res) => {
    const userId = req.userId;
    try {
        const subscriptions = await Subscription.find({ userId }).populate('packageId');
        const totalPoints = subscriptions.reduce(
            (sum, sub) => sum + (sub.remainingPoints || 0),
            0
        );

        res.json({ totalPoints, subscriptions });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.deductUserPoints = async (req, res) => {
    try {
        const userId = req.userId;
        const amount = Number(req.body.amount);
        const reportId = req.body.reportId || null;
        const reportIdsPayload = Array.isArray(req.body.reportIds)
            ? req.body.reportIds
            : typeof req.body.reportIds === 'string'
                ? req.body.reportIds.split(',').map((id) => id.trim()).filter(Boolean)
                : [];
        const reportIds = reportIdsPayload.filter(Boolean);
        const batchId = req.body.batchId || null;
        const assetCount = Number(req.body.assetCount ?? req.body.assets ?? 0);

        if (!userId) {
            return res.status(400).json({ message: "userId is required" });
        }

        if (!amount || amount <= 0) {
            return res.status(400).json({ message: "amount must be a positive number" });
        }

        const subscriptionsBefore = await Subscription.find({ userId });
        const totalBefore = subscriptionsBefore.reduce(
            (sum, sub) => sum + (Number.isFinite(sub.remainingPoints) ? sub.remainingPoints : 0),
            0
        );

        const deductionResult = await deductPoints(userId, amount);
        const totalAfter = deductionResult?.remainingPoints ?? 0;

        const deductionSource = String(req.body.source || req.body.pageSource || "packages");
        const deductionPageName =
            req.body.pageName ||
            (SOURCE_CONFIGS[deductionSource]?.pageName || DEFAULT_PAGE_NAME);
        const deductionPageSource = req.body.pageSource || deductionSource;
        const recordId = req.body.recordId || null;
        const metadata = {
            clientName: String(req.body.clientName || req.body.reportClientName || "").trim(),
            submittedAt: req.body.submittedAt || req.body.reportSubmittedAt || null,
            endSubmitTime: req.body.endSubmitTime || req.body.reportEndSubmitTime || null,
            extra: req.body.metadata || {},
        };

        const descriptor = reportIds.length
            ? `Report${reportIds.length > 1 ? 's' : ''} ${reportIds.join(', ')}`
            : reportId
                ? `Report number ${reportId}`
                : batchId
                    ? `Batch ${batchId}`
                    : "Points deduction";
        const assetPhrase = assetCount > 0 ? ` (${assetCount} assets)` : "";
        const title = reportId
            ? `${deductionPageName} – Report ${reportId}`
            : batchId
                ? `${deductionPageName} – Batch ${batchId}`
                : `${deductionPageName} – Points deducted`;
        const message = `${descriptor} on ${deductionPageName} completed${assetPhrase}. ${amount} points were deducted (${totalBefore} → ${totalAfter}).`;

        const reportSummaries = await collectReportSummaries({
            source: deductionSource,
            userId,
            reportIds,
            reportId,
            recordId,
            batchId,
            pageName: deductionPageName,
            pageSource: deductionPageSource,
        });

        const deductionRecord = await createPointDeductionRecord({
            userId,
            amount,
            assetCount,
            remainingPoints: totalAfter,
            source: deductionSource,
            pageName: deductionPageName,
            pageSource: deductionPageSource,
            reportId,
            reportIds,
            recordId,
            batchId,
            message,
            reportSummaries,
            metadata,
        });

        await createNotification({
            userId,
            type: "package",
            level: "info",
            title,
            message,
            data: {
                reportId,
                reportIds,
                batchId,
                assets: assetCount,
                deducted: amount,
                totalBefore,
                totalAfter,
                pageName: deductionPageName,
                pageSource: deductionPageSource,
                target: "deduction-history",
                deductionId: deductionRecord?._id?.toString(),
            },
        });

        return res.json({
            success: true,
            message,
            deducted: amount,
            totalBefore,
            remainingPoints: totalAfter,
            deductionId: deductionRecord?._id?.toString(),
            recordId: deductionRecord?.recordId || recordId || null,
            reportId: deductionRecord?.reportId || reportId || null,
            reportIds: Array.isArray(deductionRecord?.reportIds)
                ? deductionRecord.reportIds
                : reportIds,
            batchId: deductionRecord?.batchId || batchId || null,
            assetCount: Number.isFinite(deductionRecord?.assetCount)
                ? deductionRecord.assetCount
                : assetCount,
            source: deductionRecord?.source || deductionSource,
            pageName: deductionRecord?.pageName || deductionPageName,
            pageSource: deductionRecord?.pageSource || deductionPageSource,
            reportSummaries,
            metadata,
            createdAt: deductionRecord?.createdAt
                ? deductionRecord.createdAt.toISOString()
                : new Date().toISOString(),
        });

    } catch (error) {
        return res.status(400).json({
            success: false,
            message: error.message || "Failed to deduct points"
        });
    }
};

exports.listDeductionHistory = async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }
        const page = Math.max(Number(req.query.page) || 1, 1);
        const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
        const skip = (page - 1) * limit;
        const [records, total] = await Promise.all([
            PointDeduction.find({ userId })
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            PointDeduction.countDocuments({ userId }),
        ]);
        return res.json({
            success: true,
            data: records,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.max(1, Math.ceil(total / limit)),
            },
        });
    } catch (error) {
        console.error("Error fetching deduction history:", error);
        return res.status(500).json({
            success: false,
            message: error.message || "Failed to load deduction history",
        });
    }
};


exports.createPackageRequest = async (req, res) => {
    const { packageId, accountNumber } = req.body;
    if (!packageId) {
        return res.status(400).json({ message: 'packageId is required' });
    }
    const trimmedAccount = String(accountNumber || '').trim();
    if (!trimmedAccount) {
        return res.status(400).json({ message: 'accountNumber is required' });
    }

    try {
        const pkg = await Package.findById(packageId);
        if (!pkg) {
            return res.status(404).json({ message: 'Package not found' });
        }

        const request = new PaymentRequest({
            userId: req.userId,
            packageId: pkg._id,
            packageName: pkg.name,
            packagePoints: pkg.points,
            packagePrice: pkg.price,
            accountNumber: trimmedAccount,
            status: 'new',
            userNotified: true
        });

        await request.save();
        await request.populate(REQUEST_POPULATE);
        res.status(201).json(request);

        try {
            const adminUser = await User.findOne({ phone: ADMIN_PHONE });
            if (adminUser?._id) {
                await createNotification({
                    userId: adminUser._id,
                    type: 'package',
                    level: 'info',
                    title: 'New package request',
                    message: `New package request from ${request.userId?.phone || 'user'} for ${pkg.name}.`,
                    data: { requestId: request._id.toString(), view: 'packages', action: 'requested' }
                });
            }
            await createNotification({
                userId: req.userId,
                type: 'package',
                level: 'success',
                title: 'Request submitted',
                message: 'Your package request was submitted successfully.',
                data: { requestId: request._id.toString(), view: 'packages', action: 'requested' }
            });
        } catch (notifyError) {
            console.warn('Failed to create package request notifications', notifyError);
        }
    } catch (error) {
        res.status(500).json({ message: 'Failed to create request', error: error.message });
    }
};

exports.getPackageRequests = async (req, res) => {
    try {
        const user = await getUserById(req.userId);
        const query = isAdminUser(user) ? {} : { userId: req.userId };

        const requests = await PaymentRequest.find(query)
            .sort({ createdAt: -1 })
            .populate(REQUEST_POPULATE);

        res.json(requests || []);
    } catch (error) {
        res.status(500).json({ message: 'Failed to load requests', error: error.message });
    }
};

exports.uploadRequestTransferImage = async (req, res) => {
    const { id } = req.params;
    if (!req.file) {
        return res.status(400).json({ message: 'Transfer image is required' });
    }

    try {
        const request = await PaymentRequest.findById(id);
        if (!request) {
            return res.status(404).json({ message: 'Request not found' });
        }

        const user = await getUserById(req.userId);
        const isAdmin = isAdminUser(user);
        if (!isAdmin && request.userId.toString() !== req.userId) {
            return res.status(403).json({ message: 'Not authorized to upload for this request' });
        }

        if (request.status === 'confirmed') {
            return res.status(400).json({ message: 'Request already confirmed' });
        }

        const storedFile = await storeUploadedFile(req.file, { ownerId: request.userId, purpose: 'transfer' });
        if (request.transferImageFileId) {
            await StoredFile.findByIdAndDelete(request.transferImageFileId).catch(() => null);
        }
        request.transferImageFileId = storedFile._id;
        request.transferImagePath = buildFileUrl(storedFile._id.toString());
        request.transferImageOriginalName = storedFile.originalName || req.file.originalname;
        if (request.status === 'new') {
            request.status = 'pending';
        }
        await request.save();
        await request.populate(REQUEST_POPULATE);
        res.json(request);

        try {
            const adminUser = await User.findOne({ phone: ADMIN_PHONE });
            if (adminUser?._id) {
                await createNotification({
                    userId: adminUser._id,
                    type: 'package',
                    level: 'info',
                    title: 'Transfer uploaded',
                    message: `Transfer image uploaded for request ${request._id.toString()}.`,
                    data: { requestId: request._id.toString(), view: 'packages', action: 'transfer' }
                });
            }
            await createNotification({
                userId: request.userId,
                type: 'package',
                level: 'success',
                title: 'Transfer uploaded',
                message: 'Your transfer image was uploaded successfully.',
                data: { requestId: request._id.toString(), view: 'packages', action: 'transfer' }
            });
        } catch (notifyError) {
            console.warn('Failed to create transfer notifications', notifyError);
        }
    } catch (error) {
        res.status(500).json({ message: 'Failed to upload transfer image', error: error.message });
    }
};

exports.updatePackageRequestStatus = async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    if (!['confirmed', 'rejected'].includes(status)) {
        return res.status(400).json({ message: 'Invalid status' });
    }

    try {
        const request = await PaymentRequest.findById(id);
        if (!request) {
            return res.status(404).json({ message: 'Request not found' });
        }

        if (request.status !== 'pending') {
            return res.status(400).json({ message: 'Request already processed' });
        }

        if (status === 'confirmed' && !request.transferImagePath && !request.transferImageFileId) {
            return res.status(400).json({ message: 'Transfer image is required to approve' });
        }

        let subscription = null;
        if (status === 'confirmed') {
            const pkg = await Package.findById(request.packageId);
            if (!pkg) {
                return res.status(404).json({ message: 'Package not found' });
            }
            subscription = new Subscription({
                userId: request.userId,
                packageId: request.packageId,
                remainingPoints: pkg.points
            });
            await subscription.save();
        }

        request.status = status;
        request.decisionAt = new Date();
        request.userNotified = false;
        await request.save();
        await request.populate(REQUEST_POPULATE);

        res.json({ request, subscription });

        try {
            await createNotification({
                userId: request.userId,
                type: 'package',
                level: status === 'confirmed' ? 'success' : 'danger',
                title: status === 'confirmed' ? 'Request approved' : 'Request rejected',
                message: status === 'confirmed'
                    ? `Your package request for ${request.packageName} was approved.`
                    : `Your package request for ${request.packageName} was rejected.`,
                data: { requestId: request._id.toString(), view: 'packages', action: status }
            });
        } catch (notifyError) {
            console.warn('Failed to create decision notification', notifyError);
        }
    } catch (error) {
        res.status(500).json({ message: 'Failed to update request status', error: error.message });
    }
};

exports.updatePackageRequest = async (req, res) => {
    const { id } = req.params;
    const accountNumber = String(req.body.accountNumber || '').trim();
    if (!accountNumber) {
        return res.status(400).json({ message: 'accountNumber is required' });
    }

    try {
        const request = await PaymentRequest.findById(id);
        if (!request) {
            return res.status(404).json({ message: 'Request not found' });
        }

        if (!['new', 'pending'].includes(request.status)) {
            return res.status(400).json({ message: 'Request already processed' });
        }

        const user = await getUserById(req.userId);
        const isAdmin = isAdminUser(user);
        if (!canAccessRequest(request, req.userId, isAdmin)) {
            return res.status(403).json({ message: 'Not authorized to update this request' });
        }

        request.accountNumber = accountNumber;
        await request.save();
        await request.populate(REQUEST_POPULATE);
        return res.json(request);
    } catch (error) {
        return res.status(500).json({ message: 'Failed to update request', error: error.message });
    }
};

exports.deletePackageRequest = async (req, res) => {
    const { id } = req.params;

    try {
        const request = await PaymentRequest.findById(id);
        if (!request) {
            return res.status(404).json({ message: 'Request not found' });
        }

        if (!['new', 'pending'].includes(request.status)) {
            return res.status(400).json({ message: 'Request already processed' });
        }

        const user = await getUserById(req.userId);
        const isAdmin = isAdminUser(user);
        if (!canAccessRequest(request, req.userId, isAdmin)) {
            return res.status(403).json({ message: 'Not authorized to delete this request' });
        }

        await PaymentRequestMessage.deleteMany({ requestId: request._id });
        await request.deleteOne();
        try {
            await createNotification({
                userId: request.userId,
                type: 'package',
                level: 'danger',
                title: 'Request deleted',
                message: `Request for ${request.packageName} was deleted.`,
                data: { requestId: request._id.toString(), view: 'packages', action: 'deleted' }
            });
        } catch (notifyError) {
            console.warn('Failed to create delete request notification', notifyError);
        }
        return res.json({ message: 'Request deleted' });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to delete request', error: error.message });
    }
};

exports.acknowledgePackageRequest = async (req, res) => {
    const { id } = req.params;

    try {
        const request = await PaymentRequest.findById(id);
        if (!request) {
            return res.status(404).json({ message: 'Request not found' });
        }

        if (request.userId.toString() !== req.userId) {
            return res.status(403).json({ message: 'Not authorized to acknowledge this request' });
        }

        request.userNotified = true;
        await request.save();
        await request.populate(REQUEST_POPULATE);
        res.json(request);
    } catch (error) {
        res.status(500).json({ message: 'Failed to acknowledge request', error: error.message });
    }
};

exports.listPackageRequestMessages = async (req, res) => {
    try {
        const userId = req.userId;
        const { id } = req.params;
        const limit = sanitizeLimit(req.query.limit);
        const before = req.query.before ? new Date(req.query.before) : null;

        if (!userId) {
            return res.status(401).json({ message: 'Authentication required' });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const request = await PaymentRequest.findById(id);
        if (!request) {
            return res.status(404).json({ message: 'Request not found' });
        }

        const isAdmin = isAdminUser(user);
        if (!canAccessRequest(request, userId, isAdmin)) {
            return res.status(403).json({ message: 'Forbidden' });
        }

        const query = { requestId: id };
        if (before && !Number.isNaN(before.getTime())) {
            query.createdAt = { $lt: before };
        }

        const messages = await PaymentRequestMessage.find(query)
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();

        return res.json({ messages: messages.reverse() });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to load messages', error: error.message });
    }
};

exports.createPackageRequestMessage = async (req, res) => {
    try {
        const userId = req.userId;
        const { id } = req.params;
        const body = String(req.body.body || '').trim();
        const attachmentFiles = Array.isArray(req.files) ? req.files : [];

        if (!userId) {
            return res.status(401).json({ message: 'Authentication required' });
        }
        if (!body && attachmentFiles.length === 0) {
            return res.status(400).json({ message: 'message or attachments are required' });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const request = await PaymentRequest.findById(id);
        if (!request) {
            return res.status(404).json({ message: 'Request not found' });
        }

        const isAdmin = isAdminUser(user);
        if (!canAccessRequest(request, userId, isAdmin)) {
            return res.status(403).json({ message: 'Forbidden' });
        }

        const senderRole = isAdmin ? 'admin' : 'user';
        const attachments = await buildAttachments(attachmentFiles, user._id);
        const messageDoc = await PaymentRequestMessage.create({
            requestId: request._id,
            senderId: user._id,
            senderRole,
            senderPhone: user.phone || '',
            body,
            attachments
        });

        request.lastMessageAt = messageDoc.createdAt;
        request.lastMessagePreview = buildMessagePreview(body, attachments);
        await request.save();

        try {
            if (senderRole === 'admin') {
                await createNotification({
                    userId: request.userId,
                    type: 'package',
                    level: 'info',
                    title: 'New request message',
                    message: buildMessagePreview(body, attachments) || 'New message on your package request.',
                    data: { requestId: request._id.toString(), view: 'packages', action: 'message' }
                });
            } else {
                const adminUser = await User.findOne({ phone: ADMIN_PHONE });
                if (adminUser?._id) {
                    await createNotification({
                        userId: adminUser._id,
                        type: 'package',
                        level: 'info',
                        title: 'New request message',
                        message: buildMessagePreview(body, attachments) || 'New package request message received.',
                        data: { requestId: request._id.toString(), view: 'packages', action: 'message' }
                    });
                }
            }
        } catch (notifyError) {
            console.warn('Failed to create request message notification', notifyError);
        }

        return res.status(201).json({
            message: {
                _id: messageDoc._id.toString(),
                requestId: request._id.toString(),
                senderId: user._id.toString(),
                senderRole,
                senderPhone: user.phone || '',
                body: messageDoc.body,
                attachments: messageDoc.attachments || [],
                createdAt: messageDoc.createdAt
            }
        });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to send message', error: error.message });
    }
};
