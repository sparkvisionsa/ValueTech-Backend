const mongoose = require('mongoose');

const paymentRequestSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    packageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Package', required: true },
    packageName: { type: String, required: true },
    packagePoints: { type: Number, required: true },
    packagePrice: { type: Number, default: 0 },
    accountNumber: { type: String, default: '', trim: true },
    status: { type: String, enum: ['new', 'pending', 'confirmed', 'rejected'], default: 'new' },
    transferImagePath: { type: String, default: '' },
    transferImageOriginalName: { type: String, default: '' },
    userNotified: { type: Boolean, default: true },
    decisionAt: { type: Date, default: null },
    lastMessageAt: { type: Date, default: null },
    lastMessagePreview: { type: String, default: '' }
}, { timestamps: true });

const PaymentRequest = mongoose.model('PaymentRequest', paymentRequestSchema);
module.exports = PaymentRequest;
