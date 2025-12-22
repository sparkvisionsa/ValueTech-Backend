const Package = require('../../infrastructure/models/package');
const Subscription = require('../../infrastructure/models/subscription');

exports.getAllPackages = async (req, res) => {
    try {
        const packages = await Package.find();
        res.json(packages);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.addPackage = async (req, res) => {
    const { name, points, price } = req.body;
    if (!name || !points || !price || points <= 0 || price <= 0) {
        return res.status(400).json({ message: 'Invalid input' });
    }
    try {
        const newPackage = new Package({ name, points, price });
        await newPackage.save();
        res.status(201).json(newPackage);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.updatePackage = async (req, res) => {
    const { id } = req.params;
    const { name, points, price } = req.body;
    if (!name || !points || !price || points <= 0 || price <= 0) {
        return res.status(400).json({ message: 'Invalid input' });
    }
    try {
        const updatedPackage = await Package.findByIdAndUpdate(id, { name, points, price }, { new: true });
        if (!updatedPackage) {
            return res.status(404).json({ message: 'Package not found' });
        }
        res.json(updatedPackage);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.deletePackage = async (req, res) => {
    const { id } = req.params;
    try {
        const deletedPackage = await Package.findByIdAndDelete(id);
        if (!deletedPackage) {
            return res.status(404).json({ message: 'Package not found' });
        }
        res.json({ message: 'Package deleted' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.subscribeToPackage = async (req, res) => {
    const { packageId } = req.body;
    const userId = req.userId;
    try {
        const subscription = new Subscription({ userId, packageId });
        await subscription.save();
        res.status(201).json(subscription);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getUserSubscriptions = async (req, res) => {
    const userId = req.userId;
    try {
        const subscriptions = await Subscription.find({ userId }).populate('packageId');
        const totalPoints = subscriptions.reduce((sum, sub) => sum + sub.packageId.points, 0);
        res.json({ totalPoints, subscriptions });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
