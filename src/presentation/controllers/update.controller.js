const { verifyToken } = require('../../application/services/user/jwt.service');
const SystemUpdate = require('../../infrastructure/models/systemUpdate');
const UserUpdateStatus = require('../../infrastructure/models/userUpdateStatus');

const DEFAULT_SYSTEM = 'Electron System';
const VALID_STATUS = ['active', 'inactive', 'scheduled'];
const VALID_TYPES = ['feature', 'bugfix', 'security', 'maintenance', 'other'];
const VALID_ROLLOUT = ['mandatory', 'optional', 'monitoring'];

const optionalUserFromHeader = (req) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.substring(7);
    try {
        const decoded = verifyToken(token);
        return decoded?.id || null;
    } catch (err) {
        return null;
    }
};

exports.createUpdate = async (req, res) => {
    const {
        version,
        status = 'active',
        updateType = 'feature',
        rolloutType = 'optional',
        windowStart,
        windowEnd,
        description = '',
        notes = '',
        broadcast = true
    } = req.body;

    if (!version) {
        return res.status(400).json({ message: 'version is required' });
    }
    if (!VALID_STATUS.includes(status)) {
        return res.status(400).json({ message: 'Invalid status supplied' });
    }
    if (!VALID_TYPES.includes(updateType)) {
        return res.status(400).json({ message: 'Invalid update type' });
    }
    if (!VALID_ROLLOUT.includes(rolloutType)) {
        return res.status(400).json({ message: 'Invalid rollout type' });
    }

    try {
        const update = new SystemUpdate({
            systemName: DEFAULT_SYSTEM,
            version,
            status,
            updateType,
            rolloutType,
            windowStart: windowStart ? new Date(windowStart) : undefined,
            windowEnd: windowEnd ? new Date(windowEnd) : undefined,
            description,
            notes,
            broadcast: broadcast !== false
        });
        await update.save();
        res.status(201).json(update);
    } catch (error) {
        res.status(500).json({ message: 'Failed to create update', error: error.message });
    }
};

exports.listUpdates = async (_req, res) => {
    try {
        const updates = await SystemUpdate.find({ systemName: DEFAULT_SYSTEM }).sort({ createdAt: -1 });
        res.json(updates);
    } catch (error) {
        res.status(500).json({ message: 'Failed to list updates', error: error.message });
    }
};

exports.updateStatus = async (req, res) => {
    const { id } = req.params;
    const { status, broadcast } = req.body;

    if (status && !VALID_STATUS.includes(status)) {
        return res.status(400).json({ message: 'Invalid status supplied' });
    }

    try {
        const update = await SystemUpdate.findById(id);
        if (!update) {
            return res.status(404).json({ message: 'Update not found' });
        }

        if (status) update.status = status;
        if (typeof broadcast === 'boolean') update.broadcast = broadcast;
        await update.save();

        res.json(update);
    } catch (error) {
        res.status(500).json({ message: 'Failed to update record', error: error.message });
    }
};

exports.latestUpdateNotice = async (req, res) => {
    try {
        const update = await SystemUpdate.findOne({
            systemName: DEFAULT_SYSTEM,
            broadcast: true,
            status: { $in: ['active', 'scheduled'] }
        }).sort({ createdAt: -1 });

        if (!update) {
            return res.json({ update: null, userState: null });
        }

        const userId = optionalUserFromHeader(req);
        let userState = null;
        if (userId) {
            userState = await UserUpdateStatus.findOne({ userId, updateId: update._id });
        }

        res.json({ update, userState });
    } catch (error) {
        res.status(500).json({ message: 'Failed to load update notice', error: error.message });
    }
};

exports.markDownloaded = async (req, res) => {
    const { id } = req.params;
    const userId = req.userId;

    try {
        const update = await SystemUpdate.findById(id);
        if (!update || update.systemName !== DEFAULT_SYSTEM) {
            return res.status(404).json({ message: 'Update not found' });
        }

        const now = new Date();
        const userUpdate = await UserUpdateStatus.findOneAndUpdate(
            { userId, updateId: id },
            {
                $set: {
                    status: 'downloaded',
                    downloadedAt: now
                },
                $setOnInsert: {
                    appliedAt: null
                }
            },
            { upsert: true, new: true }
        );

        res.json(userUpdate);
    } catch (error) {
        res.status(500).json({ message: 'Failed to mark download', error: error.message });
    }
};

exports.markApplied = async (req, res) => {
    const { id } = req.params;
    const userId = req.userId;

    try {
        const update = await SystemUpdate.findById(id);
        if (!update || update.systemName !== DEFAULT_SYSTEM) {
            return res.status(404).json({ message: 'Update not found' });
        }

        const now = new Date();
        const userUpdate = await UserUpdateStatus.findOneAndUpdate(
            { userId, updateId: id },
            {
                $set: {
                    status: 'applied',
                    downloadedAt: now,
                    appliedAt: now
                }
            },
            { upsert: true, new: true }
        );

        res.json(userUpdate);
    } catch (error) {
        res.status(500).json({ message: 'Failed to apply update', error: error.message });
    }
};

exports.getUserUpdates = async (req, res) => {
    const userId = req.userId;
    try {
        const records = await UserUpdateStatus.find({ userId })
            .populate('updateId')
            .sort({ updatedAt: -1 });

        res.json(records);
    } catch (error) {
        res.status(500).json({ message: 'Failed to load user updates', error: error.message });
    }
};
