const mongoose = require('mongoose');

const taqeemValuerSchema = new mongoose.Schema(
    {
        valuerId: { type: String, default: null },
        valuerName: { type: String, default: null }
    },
    { _id: false }
);

const taqeemCompanySchema = new mongoose.Schema(
    {
        officeId: { type: String, default: null },
        sectorId: { type: String, default: null },
        name: { type: String, default: 'Unknown company' },
        url: { type: String, default: null },
        type: { type: String, enum: ['real-estate', 'equipment'], default: 'equipment' },
        valuers: { type: [taqeemValuerSchema], default: [] }
    },
    { _id: false }
);

const userSchema = new mongoose.Schema({
    phone: { type: String, unique: true, sparse: true, index: true },
    phones: { type: [String], default: [] },
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
        profile: { type: mongoose.Schema.Types.Mixed, default: null },
        companies: { type: [taqeemCompanySchema], default: [] },
        defaultCompanyOfficeId: { type: String, default: null },
        firstCompanySelectedAt: { type: Date, default: null },
        lastSyncedAt: { type: Date, default: null },
        bootstrap_used: { type: Boolean, default: false },
        bootstrap_uses: { type: Number, default: 0 },
    },
    permissions: { type: [String], default: [] }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
module.exports = User;
