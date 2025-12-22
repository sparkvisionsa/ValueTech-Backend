const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    phone: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    type: { type: String, enum: ['individual', 'company'], default: 'individual' },
    role: { type: String, enum: ['individual', 'company-head', 'member'], default: 'individual' },
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', default: null },
    companyName: { type: String },
    headName: { type: String },
    displayName: { type: String },
    permissions: { type: [String], default: [] }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
module.exports = User;