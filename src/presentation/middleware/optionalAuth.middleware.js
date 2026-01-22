const { verifyToken } = require('../../application/services/user/jwt.service');

const optionalAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    let token = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
    } else if (req.cookies?.refreshToken) {
        token = req.cookies.refreshToken;
    }

    if (!token) {
        req.userId = null;
        req.user = null;
        return next();
    }

    try {
        const decoded = verifyToken(token);
        req.userId = decoded.id;
        req.user = decoded;
    } catch (error) {
        req.userId = null;
        req.user = null;
    }

    next();
};

module.exports = optionalAuth;
