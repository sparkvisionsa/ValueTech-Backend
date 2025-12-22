const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';
const COOKIE_NAME = 'refreshToken';  // or the cookie name you use

function authMiddleware(req, res, next) {
  let token = null;

  // Prefer Authorization header when provided, otherwise fall back to the refresh token cookie
  if (req.headers?.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.replace('Bearer ', '');
  } else {
    token = req.cookies?.[COOKIE_NAME];
  }

  if (!token) {
    return res.status(401).json({ message: 'Unauthorized: No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;  // you may want different data/claims for refresh tokens
    next();
  } catch (err) {
    console.error('JWT verification failed:', err);
    return res.status(403).json({ message: 'Forbidden: Invalid or expired token.' });
  }
}

module.exports = authMiddleware;
