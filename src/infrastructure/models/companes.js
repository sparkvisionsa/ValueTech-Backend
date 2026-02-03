const mongoose = require('mongoose');

const companesSchema = new mongoose.Schema(
    {
        name: { type: String, required: true },
        type: { type: String, enum: ['real-estate', 'equipment'], required: true },
        phone: { type: String, required: true }, // owner phone
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        url: { type: String, default: '' },
        officeId: { type: String },
        sectorId: { type: String },
        valuers: {
            type: [
                {
                    valuerId: { type: String },
                    valuerName: { type: String }
                }
            ],
            default: []
        }
    },
    {
        timestamps: true,
        collection: 'companes'
    }
);

// Prevent duplicates per user/phone + office or legacy name+type when officeId missing
companesSchema.index(
    { phone: 1, officeId: 1, type: 1 },
    {
        unique: true,
        partialFilterExpression: { officeId: { $exists: true, $ne: null } }
    }
);
companesSchema.index(
    { phone: 1, name: 1, type: 1 },
    { unique: true, partialFilterExpression: { officeId: null } }
);

const Companes = mongoose.model('Companes', companesSchema);
module.exports = Companes;
