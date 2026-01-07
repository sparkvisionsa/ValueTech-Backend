const Ticket = require('../../infrastructure/models/ticket');
const TicketMessage = require('../../infrastructure/models/ticketMessage');
const User = require('../../infrastructure/models/user');
const { getSocketServer } = require('../sockets/socketRegistry');
const { ADMIN_PHONE, SUPPORT_PHONES, isAdminUser, isSupportUser } = require('../../utils/supportUsers');
const PREVIEW_LIMIT = 140;

const buildPreview = (text = '') => {
    const trimmed = text.trim();
    if (trimmed.length <= PREVIEW_LIMIT) return trimmed;
    return `${trimmed.slice(0, PREVIEW_LIMIT)}...`;
};

const buildAttachments = (files = []) => {
    if (!Array.isArray(files)) return [];
    return files.map((file) => ({
        url: `/uploads/tickets/${file.filename}`,
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

const STATUS_VALUES = ['waiting', 'in_support', 'open', 'closed', 'reopened'];

const sanitizeLimit = (value, fallback = 50) => {
    const limit = Number(value);
    if (!Number.isFinite(limit) || limit <= 0) return fallback;
    return Math.min(limit, 200);
};

const resolveId = (value) => {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (value._id) return value._id.toString();
    return value.toString();
};

const canViewTicket = (ticket, user, userId) => {
    if (!ticket || !user) return false;
    if (isAdminUser(user) || isSupportUser(user)) return true;
    return resolveId(ticket.createdBy) === userId.toString();
};

const canManageTicket = (ticket, user) => {
    if (!ticket || !user) return false;
    if (isAdminUser(user)) return true;
    if (isSupportUser(user)) {
        return resolveId(ticket.assignedTo) === user._id.toString();
    }
    return resolveId(ticket.createdBy) === user._id.toString();
};

const buildAssignedPayload = (assignedTo) => {
    if (!assignedTo) return null;
    return {
        _id: assignedTo._id.toString(),
        phone: assignedTo.phone || '',
        displayName: assignedTo.displayName || ''
    };
};

exports.createTicket = async (req, res) => {
    try {
        const { subject, message } = req.body;
        const userId = req.userId;

        if (!userId) {
            return res.status(401).json({ message: 'Authentication required' });
        }
        if (!subject) {
            return res.status(400).json({ message: 'subject is required' });
        }

        const attachments = buildAttachments(req.files);
        const messageBody = String(message || '').trim();
        if (!messageBody && attachments.length === 0) {
            return res.status(400).json({ message: 'message or attachments are required' });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const adminUser = await User.findOne({ phone: ADMIN_PHONE });
        const preview = buildMessagePreview(messageBody, attachments);

        const ticket = await Ticket.create({
            subject: String(subject).trim(),
            createdBy: user._id,
            assignedTo: adminUser?._id || null,
            status: 'waiting',
            lastMessagePreview: preview
        });

        const ticketMessage = await TicketMessage.create({
            ticketId: ticket._id,
            senderId: user._id,
            senderRole: 'user',
            senderPhone: user.phone || '',
            body: messageBody,
            attachments
        });

        ticket.lastMessageAt = ticketMessage.createdAt;
        await ticket.save();

        const payload = {
            _id: ticket._id.toString(),
            subject: ticket.subject,
            status: ticket.status,
            createdAt: ticket.createdAt,
            updatedAt: ticket.updatedAt,
            lastMessageAt: ticket.lastMessageAt,
            lastMessagePreview: ticket.lastMessagePreview,
            createdBy: {
                _id: user._id.toString(),
                phone: user.phone || '',
                displayName: user.displayName || ''
            },
            assignedTo: adminUser
                ? {
                    _id: adminUser._id.toString(),
                    phone: adminUser.phone || '',
                    displayName: adminUser.displayName || ''
                }
                : null
        };

        const io = getSocketServer();
        if (io) {
            io.to('admin:all').emit('ticket:created', payload);
            io.to('support:all').emit('ticket:created', payload);
            io.to(`user:${user._id}`).emit('ticket:created', payload);
        }

        return res.status(201).json({
            ticket: payload,
            message: {
                _id: ticketMessage._id.toString(),
                ticketId: ticketMessage.ticketId.toString(),
                senderId: ticketMessage.senderId.toString(),
                senderRole: ticketMessage.senderRole,
                senderPhone: ticketMessage.senderPhone,
                body: ticketMessage.body,
                attachments: ticketMessage.attachments || [],
                createdAt: ticketMessage.createdAt
            }
        });
    } catch (err) {
        return res.status(500).json({ message: 'Failed to create ticket', error: err.message });
    }
};

exports.listTickets = async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            return res.status(401).json({ message: 'Authentication required' });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const canSeeAll = isAdminUser(user) || isSupportUser(user);
        const query = canSeeAll ? {} : { createdBy: userId };
        const tickets = await Ticket.find(query)
            .sort({ lastMessageAt: -1, updatedAt: -1 })
            .populate('createdBy', 'phone displayName')
            .populate('assignedTo', 'phone displayName')
            .lean();

        return res.json({ tickets });
    } catch (err) {
        return res.status(500).json({ message: 'Failed to load tickets', error: err.message });
    }
};

exports.getTicket = async (req, res) => {
    try {
        const userId = req.userId;
        const { id } = req.params;
        if (!userId) {
            return res.status(401).json({ message: 'Authentication required' });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const ticket = await Ticket.findById(id)
            .populate('createdBy', 'phone displayName')
            .populate('assignedTo', 'phone displayName');

        if (!ticket) {
            return res.status(404).json({ message: 'Ticket not found' });
        }
        if (!canViewTicket(ticket, user, userId)) {
            return res.status(403).json({ message: 'Forbidden' });
        }

        return res.json({ ticket });
    } catch (err) {
        return res.status(500).json({ message: 'Failed to load ticket', error: err.message });
    }
};

exports.listMessages = async (req, res) => {
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

        const ticket = await Ticket.findById(id);
        if (!ticket) {
            return res.status(404).json({ message: 'Ticket not found' });
        }
        if (!canViewTicket(ticket, user, userId)) {
            return res.status(403).json({ message: 'Forbidden' });
        }

        const query = { ticketId: id };
        if (before && !Number.isNaN(before.getTime())) {
            query.createdAt = { $lt: before };
        }

        const messages = await TicketMessage.find(query)
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();

        return res.json({ messages: messages.reverse() });
    } catch (err) {
        return res.status(500).json({ message: 'Failed to load messages', error: err.message });
    }
};

exports.createMessage = async (req, res) => {
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

        const ticket = await Ticket.findById(id);
        if (!ticket) {
            return res.status(404).json({ message: 'Ticket not found' });
        }
        if (!canManageTicket(ticket, user)) {
            return res.status(403).json({ message: 'Forbidden' });
        }

        const senderRole = isAdminUser(user) ? 'admin' : isSupportUser(user) ? 'support' : 'user';
        const messageDoc = await TicketMessage.create({
            ticketId: ticket._id,
            senderId: user._id,
            senderRole,
            senderPhone: user.phone || '',
            body,
            attachments
        });

        ticket.lastMessageAt = messageDoc.createdAt;
        ticket.lastMessagePreview = buildMessagePreview(body, attachments);
        await ticket.save();

        const messagePayload = {
            _id: messageDoc._id.toString(),
            ticketId: ticket._id.toString(),
            senderId: user._id.toString(),
            senderRole,
            senderPhone: user.phone || '',
            body: messageDoc.body,
            attachments: messageDoc.attachments || [],
            createdAt: messageDoc.createdAt
        };

        const io = getSocketServer();
        if (io) {
            io.to(`ticket:${ticket._id}`).emit('ticket:message', messagePayload);
            io.to(`user:${ticket.createdBy}`).emit('ticket:updated', {
                ticketId: ticket._id.toString(),
                lastMessageAt: ticket.lastMessageAt,
                lastMessagePreview: ticket.lastMessagePreview,
                status: ticket.status,
                updatedAt: ticket.updatedAt
            });
            io.to('admin:all').emit('ticket:updated', {
                ticketId: ticket._id.toString(),
                lastMessageAt: ticket.lastMessageAt,
                lastMessagePreview: ticket.lastMessagePreview,
                status: ticket.status,
                updatedAt: ticket.updatedAt
            });
            io.to('support:all').emit('ticket:updated', {
                ticketId: ticket._id.toString(),
                lastMessageAt: ticket.lastMessageAt,
                lastMessagePreview: ticket.lastMessagePreview,
                status: ticket.status,
                updatedAt: ticket.updatedAt
            });
        }

        return res.status(201).json({ message: messagePayload });
    } catch (err) {
        return res.status(500).json({ message: 'Failed to send message', error: err.message });
    }
};

exports.assignTicket = async (req, res) => {
    try {
        const userId = req.userId;
        const { id } = req.params;
        const { supportPhone } = req.body;

        if (!userId) {
            return res.status(401).json({ message: 'Authentication required' });
        }
        if (!supportPhone) {
            return res.status(400).json({ message: 'supportPhone is required' });
        }
        if (!SUPPORT_PHONES.includes(String(supportPhone))) {
            return res.status(400).json({ message: 'Support phone is not allowed' });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        if (!isAdminUser(user)) {
            return res.status(403).json({ message: 'Admin access required' });
        }

        const supportUser = await User.findOne({ phone: String(supportPhone) });
        if (!supportUser) {
            return res.status(404).json({ message: 'Support user not found' });
        }

        const ticket = await Ticket.findById(id)
            .populate('createdBy', 'phone displayName')
            .populate('assignedTo', 'phone displayName');
        if (!ticket) {
            return res.status(404).json({ message: 'Ticket not found' });
        }

        ticket.assignedTo = supportUser._id;
        ticket.status = 'in_support';
        await ticket.save();
        await ticket.populate([
            { path: 'createdBy', select: 'phone displayName' },
            { path: 'assignedTo', select: 'phone displayName' }
        ]);

        const updatePayload = {
            ticketId: ticket._id.toString(),
            status: ticket.status,
            assignedTo: buildAssignedPayload(ticket.assignedTo),
            updatedAt: ticket.updatedAt
        };

        const io = getSocketServer();
        if (io) {
            io.to(`user:${ticket.createdBy?._id || ticket.createdBy}`).emit('ticket:updated', updatePayload);
            io.to('admin:all').emit('ticket:updated', updatePayload);
            io.to('support:all').emit('ticket:updated', updatePayload);
        }

        return res.json({ ticket });
    } catch (err) {
        return res.status(500).json({ message: 'Failed to assign ticket', error: err.message });
    }
};

exports.takeTicket = async (req, res) => {
    try {
        const userId = req.userId;
        const { id } = req.params;

        if (!userId) {
            return res.status(401).json({ message: 'Authentication required' });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        if (!isSupportUser(user)) {
            return res.status(403).json({ message: 'Support access required' });
        }

        const ticket = await Ticket.findById(id)
            .populate('createdBy', 'phone displayName')
            .populate('assignedTo', 'phone displayName');
        if (!ticket) {
            return res.status(404).json({ message: 'Ticket not found' });
        }

        if (ticket.assignedTo && ticket.assignedTo._id?.toString() !== user._id.toString()) {
            if (!isAdminUser(ticket.assignedTo)) {
                return res.status(409).json({ message: 'Ticket already assigned' });
            }
        }

        ticket.assignedTo = user._id;
        ticket.status = 'in_support';
        await ticket.save();
        await ticket.populate([
            { path: 'createdBy', select: 'phone displayName' },
            { path: 'assignedTo', select: 'phone displayName' }
        ]);

        const updatePayload = {
            ticketId: ticket._id.toString(),
            status: ticket.status,
            assignedTo: buildAssignedPayload(ticket.assignedTo),
            updatedAt: ticket.updatedAt
        };

        const io = getSocketServer();
        if (io) {
            io.to(`user:${ticket.createdBy?._id || ticket.createdBy}`).emit('ticket:updated', updatePayload);
            io.to('admin:all').emit('ticket:updated', updatePayload);
            io.to('support:all').emit('ticket:updated', updatePayload);
        }

        return res.json({ ticket });
    } catch (err) {
        return res.status(500).json({ message: 'Failed to take ticket', error: err.message });
    }
};

exports.updateTicketStatus = async (req, res) => {
    try {
        const userId = req.userId;
        const { id } = req.params;
        const { status } = req.body;

        if (!userId) {
            return res.status(401).json({ message: 'Authentication required' });
        }
        if (!STATUS_VALUES.includes(status)) {
            return res.status(400).json({ message: 'Invalid status' });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const ticket = await Ticket.findById(id)
            .populate('createdBy', 'phone displayName')
            .populate('assignedTo', 'phone displayName');
        if (!ticket) {
            return res.status(404).json({ message: 'Ticket not found' });
        }

        if (!isAdminUser(user)) {
            if (!isSupportUser(user) || ticket.assignedTo?._id?.toString() !== user._id.toString()) {
                return res.status(403).json({ message: 'Forbidden' });
            }
        }

        ticket.status = status;
        await ticket.save();
        await ticket.populate([
            { path: 'createdBy', select: 'phone displayName' },
            { path: 'assignedTo', select: 'phone displayName' }
        ]);

        const updatePayload = {
            ticketId: ticket._id.toString(),
            status: ticket.status,
            assignedTo: buildAssignedPayload(ticket.assignedTo),
            updatedAt: ticket.updatedAt
        };

        const io = getSocketServer();
        if (io) {
            io.to(`user:${ticket.createdBy?._id || ticket.createdBy}`).emit('ticket:updated', updatePayload);
            io.to('admin:all').emit('ticket:updated', updatePayload);
            io.to('support:all').emit('ticket:updated', updatePayload);
        }

        return res.json({ ticket });
    } catch (err) {
        return res.status(500).json({ message: 'Failed to update ticket', error: err.message });
    }
};
