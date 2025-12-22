const mongoose = require('mongoose');

const ADMIN_PHONE = process.env.ADMIN_PHONE || '011111';
const DEFAULT_SYSTEM = 'Electron System';

const systemStateSchema = new mongoose.Schema({
    systemName: { type: String, default: DEFAULT_SYSTEM },
    mode: { type: String, enum: ['active', 'inactive', 'partial', 'demo'], default: 'active' },
    expectedReturn: { type: Date },
    downtimeDays: { type: Number, default: 0 },
    downtimeHours: { type: Number, default: 0 },
    notes: { type: String },
    partialMessage: { type: String, default: '' },
    allowedModules: [{ type: String }],
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedByPhone: { type: String, default: ADMIN_PHONE },
}, { timestamps: true });

systemStateSchema.statics.getSingleton = async function () {
    let state = await this.findOne({ systemName: DEFAULT_SYSTEM });
    if (!state) {
        state = await this.create({
            systemName: DEFAULT_SYSTEM,
            mode: 'active',
            allowedModules: []
        });
    }
    return state;
};

const SystemState = mongoose.model('SystemState', systemStateSchema);
module.exports = SystemState;
