const mongoose = require('mongoose');

const storedFileSchema = new mongoose.Schema(
    {
        originalName: { type: String, default: '' },
        mimeType: { type: String, default: '' },
        size: { type: Number, default: 0 },
        data: { type: Buffer, required: true },
        ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        purpose: { type: String, default: '' }
    },
    { timestamps: true }
);

storedFileSchema.index({ createdAt: -1 });

module.exports = mongoose.model('StoredFile', storedFileSchema);
