const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '10h'; // e.g. '15m', '1h', '7d'
const REFRESH_TOKEN_EXPIRES_IN = process.env.REFRESH_TOKEN_EXPIRES_IN || '7d';

function generateAccessToken(userPayload) {
  return jwt.sign(userPayload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function generateRefreshToken(userPayload) {
  return jwt.sign(userPayload, JWT_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRES_IN });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyToken
};