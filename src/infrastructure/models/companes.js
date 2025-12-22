const mongoose = require('mongoose');

const companesSchema = new mongoose.Schema(
    {
        name: { type: String, required: true },
        type: { type: String, enum: ['real-estate', 'equipment'], required: true },
        phone: { type: String, required: true }, // owner phone
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        url: { type: String, default: '' },
        officeId: { type: String },
        sectorId: { type: String }
    },
    {
        timestamps: true,
        collection: 'companes'
    }
);

// Prevent duplicates per user/phone + name + type
companesSchema.index({ phone: 1, name: 1, type: 1 }, { unique: true });

const Companes = mongoose.model('Companes', companesSchema);
module.exports = Companes;
