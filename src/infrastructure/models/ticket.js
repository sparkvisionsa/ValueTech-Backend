const mongoose = require('mongoose');

const ticketSchema = new mongoose.Schema(
    {
        subject: { type: String, required: true, trim: true, maxlength: 200 },
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
        status: {
            type: String,
            enum: ['waiting', 'in_support', 'open', 'closed', 'reopened'],
            default: 'waiting'
        },
        lastMessageAt: { type: Date, default: null },
        lastMessagePreview: { type: String, default: '' }
    },
    { timestamps: true }
);

ticketSchema.index({ updatedAt: -1 });
ticketSchema.index({ lastMessageAt: -1 });

module.exports = mongoose.model('Ticket', ticketSchema);
