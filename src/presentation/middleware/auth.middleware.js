const { verifyToken } = require('../../application/services/user/jwt.service');

const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Access token required' });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    try {
        const decoded = verifyToken(token);
        req.userId = decoded.id; // Set the userId from the token payload
        next();
    } catch (error) {
        return res.status(401).json({ message: 'Invalid or expired token' });
    }
};

module.exports = authMiddleware;
