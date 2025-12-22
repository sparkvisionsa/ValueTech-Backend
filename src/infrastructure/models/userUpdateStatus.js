const mongoose = require('mongoose');

const userUpdateStatusSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    updateId: { type: mongoose.Schema.Types.ObjectId, ref: 'SystemUpdate', required: true },
    status: { type: String, enum: ['notified', 'downloaded', 'applied'], default: 'notified' },
    downloadedAt: { type: Date },
    appliedAt: { type: Date }
}, { timestamps: true });

userUpdateStatusSchema.index({ userId: 1, updateId: 1 }, { unique: true });

const UserUpdateStatus = mongoose.model('UserUpdateStatus', userUpdateStatusSchema);
module.exports = UserUpdateStatus;
