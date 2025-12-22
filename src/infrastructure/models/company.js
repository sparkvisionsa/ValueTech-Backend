const mongoose = require('mongoose');

const companySchema = new mongoose.Schema({
    name: { type: String, required: true },
    headName: { type: String, required: true },
    phone: { type: String, required: true },
    headUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

const Company = mongoose.model('Company', companySchema);
module.exports = Company;
