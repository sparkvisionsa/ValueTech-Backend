const mongoose = require('mongoose');

const ticketMessageSchema = new mongoose.Schema(
    {
        ticketId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', required: true, index: true },
        senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        senderRole: { type: String, enum: ['user', 'admin', 'support'], required: true },
        senderPhone: { type: String, default: '' },
        body: { type: String, trim: true, maxlength: 4000, default: '' },
        attachments: {
            type: [
                {
                    fileId: { type: mongoose.Schema.Types.ObjectId, ref: 'StoredFile', default: null },
                    url: { type: String, required: true },
                    name: { type: String, default: '' },
                    type: { type: String, default: '' },
                    size: { type: Number, default: 0 }
                }
            ],
            default: []
        }
    },
    { timestamps: true }
);

ticketMessageSchema.index({ ticketId: 1, createdAt: -1 });

module.exports = mongoose.model('TicketMessage', ticketMessageSchema);
