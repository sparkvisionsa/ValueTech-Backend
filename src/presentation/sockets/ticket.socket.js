const { verifyToken } = require('../../application/services/user/jwt.service');
const User = require('../../infrastructure/models/user');
const Ticket = require('../../infrastructure/models/ticket');
const TicketMessage = require('../../infrastructure/models/ticketMessage');

const { isAdminUser, isSupportUser } = require('../../utils/supportUsers');
const PREVIEW_LIMIT = 140;

const buildPreview = (text = '') => {
    const trimmed = text.trim();
    if (trimmed.length <= PREVIEW_LIMIT) return trimmed;
    return `${trimmed.slice(0, PREVIEW_LIMIT)}...`;
};

const canAccessTicket = (ticket, user) => {
    if (!ticket || !user) return false;
    if (isAdminUser(user) || isSupportUser(user)) return true;
    return ticket.createdBy?.toString() === user._id.toString();
};

const canSendMessage = (ticket, user) => {
    if (!ticket || !user) return false;
    if (isAdminUser(user)) return true;
    if (isSupportUser(user)) {
        return ticket.assignedTo?.toString() === user._id.toString();
    }
    return ticket.createdBy?.toString() === user._id.toString();
};

const registerTicketSocket = (io) => {
    io.use(async (socket, next) => {
        const token = socket.handshake?.auth?.token || socket.handshake?.query?.token;
        if (!token) return next(new Error('AUTH_REQUIRED'));

        try {
            const payload = verifyToken(token);
            const user = await User.findById(payload.id);
            if (!user) return next(new Error('USER_NOT_FOUND'));
            socket.user = user;
            socket.isAdmin = isAdminUser(user);
            socket.isSupport = isSupportUser(user);
            socket.join(`user:${user._id}`);
            if (socket.isAdmin) {
                socket.join('admin:all');
            }
            if (socket.isSupport) {
                socket.join('support:all');
            }
            return next();
        } catch (err) {
            return next(new Error('AUTH_INVALID'));
        }
    });

    io.on('connection', (socket) => {
        socket.on('ticket:join', async (payload = {}, ack) => {
            try {
                const { ticketId } = payload;
                if (!ticketId) {
                    if (ack) ack({ ok: false, error: 'ticketId is required' });
                    return;
                }
                const ticket = await Ticket.findById(ticketId);
                if (!ticket) {
                    if (ack) ack({ ok: false, error: 'Ticket not found' });
                    return;
                }
                if (!canAccessTicket(ticket, socket.user)) {
                    if (ack) ack({ ok: false, error: 'Forbidden' });
                    return;
                }
                socket.join(`ticket:${ticketId}`);
                if (ack) ack({ ok: true });
            } catch (err) {
                if (ack) ack({ ok: false, error: err.message });
            }
        });

        socket.on('ticket:leave', (payload = {}) => {
            const { ticketId } = payload;
            if (!ticketId) return;
            socket.leave(`ticket:${ticketId}`);
        });

        socket.on('ticket:message', async (payload = {}, ack) => {
            try {
                const { ticketId, body } = payload;
                const trimmedBody = String(body || '').trim();
                if (!ticketId || !trimmedBody) {
                    if (ack) ack({ ok: false, error: 'ticketId and message are required' });
                    return;
                }

                const ticket = await Ticket.findById(ticketId);
                if (!ticket) {
                    if (ack) ack({ ok: false, error: 'Ticket not found' });
                    return;
                }
                if (!canSendMessage(ticket, socket.user)) {
                    if (ack) ack({ ok: false, error: 'Forbidden' });
                    return;
                }

                const senderRole = socket.isAdmin ? 'admin' : socket.isSupport ? 'support' : 'user';
                const message = await TicketMessage.create({
                    ticketId,
                    senderId: socket.user._id,
                    senderRole,
                    senderPhone: socket.user.phone || '',
                    body: trimmedBody
                });

                const preview = buildPreview(trimmedBody);
                ticket.lastMessageAt = message.createdAt;
                ticket.lastMessagePreview = preview;
                await ticket.save();

                const messagePayload = {
                    _id: message._id,
                    ticketId: ticketId.toString(),
                    senderId: message.senderId.toString(),
                    senderRole: message.senderRole,
                    senderPhone: message.senderPhone,
                    body: message.body,
                    attachments: message.attachments || [],
                    createdAt: message.createdAt
                };

                io.to(`ticket:${ticketId}`).emit('ticket:message', messagePayload);

                const ticketUpdate = {
                    ticketId: ticket._id.toString(),
                    lastMessageAt: ticket.lastMessageAt,
                    lastMessagePreview: ticket.lastMessagePreview,
                    status: ticket.status,
                    updatedAt: ticket.updatedAt
                };

                io.to(`user:${ticket.createdBy}`).emit('ticket:updated', ticketUpdate);
                io.to('admin:all').emit('ticket:updated', ticketUpdate);
                io.to('support:all').emit('ticket:updated', ticketUpdate);

                if (ack) ack({ ok: true, message: messagePayload });
            } catch (err) {
                if (ack) ack({ ok: false, error: err.message || 'Failed to send message' });
            }
        });
    });
};

module.exports = registerTicketSocket;
