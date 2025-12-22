const mongoose = require('mongoose');

const packageSchema = new mongoose.Schema({
    name: { type: String, required: true },
    points: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0.01 },
}, { timestamps: true });

const Package = mongoose.model('Package', packageSchema);
module.exports = Package;
