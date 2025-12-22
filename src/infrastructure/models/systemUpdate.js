const mongoose = require('mongoose');

const DEFAULT_SYSTEM = 'Electron System';

const systemUpdateSchema = new mongoose.Schema({
    systemName: { type: String, default: DEFAULT_SYSTEM },
    version: { type: String, required: true },
    status: { type: String, enum: ['active', 'inactive', 'scheduled'], default: 'active' },
    updateType: { type: String, enum: ['feature', 'bugfix', 'security', 'maintenance', 'other'], default: 'feature' },
    rolloutType: { type: String, enum: ['mandatory', 'optional', 'monitoring'], default: 'optional' },
    windowStart: { type: Date },
    windowEnd: { type: Date },
    description: { type: String, default: '' },
    notes: { type: String, default: '' },
    broadcast: { type: Boolean, default: true }
}, { timestamps: true });

const SystemUpdate = mongoose.model('SystemUpdate', systemUpdateSchema);
module.exports = SystemUpdate;
