const Package = require('../../infrastructure/models/package');
const Subscription = require('../../infrastructure/models/subscription');
const PaymentRequest = require('../../infrastructure/models/paymentRequest');
const PaymentRequestMessage = require('../../infrastructure/models/paymentRequestMessage');
const User = require('../../infrastructure/models/user');
const deductPoints = require('../../application/services/packages/deductPoints');

const ADMIN_PHONE = process.env.ADMIN_PHONE || '011111';
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

const buildAttachments = (files = []) => {
    if (!Array.isArray(files)) return [];
    return files.map((file) => ({
        url: `/uploads/request-messages/${file.filename}`,
        name: file.originalname || file.filename,
        type: file.mimetype || '',
        size: file.size || 0
    }));
};

const buildMessagePreview = (body = '', attachments = []) => {
    const trimmed = String(body || '').trim();
    if (trimmed) return buildPreview(trimmed);
    if (attachments.length === 1) return 'Attachment';
    if (attachments.length > 1) return `${attachments.length} attachments`;
    return '';
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

        if (!userId) {
            return res.status(400).json({ message: "userId is required" });
        }

        if (!amount || amount <= 0) {
            return res.status(400).json({ message: "amount must be a positive number" });
        }

        await deductPoints(userId, amount);

        return res.json({
            success: true,
            message: `Deducted ${amount} points successfully`
        });

    } catch (error) {
        return res.status(400).json({
            success: false,
            message: error.message || "Failed to deduct points"
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

        request.transferImagePath = `/uploads/transfers/${req.file.filename}`;
        request.transferImageOriginalName = req.file.originalname;
        if (request.status === 'new') {
            request.status = 'pending';
        }
        await request.save();
        await request.populate(REQUEST_POPULATE);
        res.json(request);
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

        if (status === 'confirmed' && !request.transferImagePath) {
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
        const attachments = buildAttachments(req.files);

        if (!userId) {
            return res.status(401).json({ message: 'Authentication required' });
        }
        if (!body && attachments.length === 0) {
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
