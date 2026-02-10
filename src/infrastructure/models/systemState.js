const mongoose = require('mongoose');

const ADMIN_PHONE = '000';
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
    guestAccessEnabled: { type: Boolean, default: true },
    guestAccessLimit: { type: Number, default: 1 },
    guestFreePoints: { type: Number, default: 400 },
    ramTabsPerGb: { type: Number, default: 5 },
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
