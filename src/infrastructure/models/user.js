const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    phone: { type: String, unique: true },
    password: { type: String },
    type: { type: String, enum: ['individual', 'company'], default: 'individual' },
    role: { type: String, enum: ['individual', 'company-head', 'member'], default: 'individual' },
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', default: null },
    companyName: { type: String },
    headName: { type: String },
    displayName: { type: String },
    profileImagePath: { type: String, default: '' },
    profileImageFileId: { type: mongoose.Schema.Types.ObjectId, ref: 'StoredFile', default: null },
    taqeem: {
        username: { type: String, index: true },
        password: { type: String },
        bootstrap_used: { type: Boolean, default: false },
        bootstrap_uses: { type: Number, default: 0 },
    },
    permissions: { type: [String], default: [] }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
module.exports = User;
