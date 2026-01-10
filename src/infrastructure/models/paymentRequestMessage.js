const mongoose = require('mongoose');

const paymentRequestMessageSchema = new mongoose.Schema(
    {
        requestId: { type: mongoose.Schema.Types.ObjectId, ref: 'PaymentRequest', required: true, index: true },
        senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        senderRole: { type: String, enum: ['user', 'admin'], required: true },
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

paymentRequestMessageSchema.index({ requestId: 1, createdAt: -1 });

module.exports = mongoose.model('PaymentRequestMessage', paymentRequestMessageSchema);
