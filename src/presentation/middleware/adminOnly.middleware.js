const User = require('../../infrastructure/models/user');

const ADMIN_PHONE = process.env.ADMIN_PHONE || '011111';

const adminOnly = async (req, res, next) => {
    try {
        if (!req.userId) {
            return res.status(401).json({ message: 'Authentication required' });
        }

        const user = await User.findById(req.userId);
        if (!user || user.phone !== ADMIN_PHONE) {
            return res.status(403).json({ message: 'Admin access required' });
        }

        req.user = user;
        next();
    } catch (error) {
        return res.status(500).json({ message: 'Failed to verify admin', error: error.message });
    }
};

module.exports = adminOnly;
