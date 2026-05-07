const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../config');
const logger = require('../utils/logger');

const JWT_SECRET = config.JWT_SECRET;
const JWT_REFRESH_SECRET = config.JWT_REFRESH_SECRET || config.JWT_SECRET;
const JWT_EXPIRES_IN = config.JWT_EXPIRES_IN;
const REFRESH_TOKEN_EXPIRES_IN = config.REFRESH_TOKEN_EXPIRES_IN || '7d';
const IS_PRODUCTION = config.NODE_ENV === 'production';

/**
 * Convert a duration string like '24h', '7d', '30m', '60s' to milliseconds.
 */
const durationToMs = (duration) => {
  const match = duration.match(/^(\d+)([smhd])$/);
  if (!match) {
    logger.warn(`Invalid duration format "${duration}", defaulting to 24h`);
    return 24 * 60 * 60 * 1000;
  }
  const value = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case 's': return value * 1000;
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default: return 24 * 60 * 60 * 1000;
  }
};

// JWT validation middleware
// Checks Authorization header first, then falls back to httpOnly cookie
// Enforces CSRF validation for state-changing methods if using cookie auth
const validateJWT = (req, res, next) => {
  const headerToken = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : null;

  const cookieToken = req.cookies?.fitcher_access_token || null;

  const token = headerToken || cookieToken;

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Access token required',
      code: 'TOKEN_REQUIRED'
    });
  }

  // CSRF Protection for state-changing methods
  if (!headerToken && cookieToken && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    const csrfHeader = req.headers['x-csrf-token'];
    const csrfCookie = req.cookies?.csrf_token;

    if (!csrfHeader || !csrfCookie || csrfHeader !== csrfCookie) {
      return res.status(403).json({
        success: false,
        error: 'Invalid CSRF token',
        code: 'CSRF_INVALID'
      });
    }
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Token expired',
        code: 'TOKEN_EXPIRED'
      });
    }

    return res.status(401).json({
      success: false,
      error: 'Invalid token',
      code: 'TOKEN_INVALID'
    });
  }
};

// Generate JWT tokens
const generateTokens = (userId, email) => {
  const accessToken = jwt.sign(
    { userId, email, type: 'access' },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );

  const refreshToken = jwt.sign(
    { userId, email, type: 'refresh' },
    JWT_REFRESH_SECRET,
    { expiresIn: REFRESH_TOKEN_EXPIRES_IN }
  );

  const csrfToken = crypto.randomBytes(32).toString('hex');

  return { accessToken, refreshToken, csrfToken };
};

// Set both access and refresh tokens as httpOnly cookies, and csrf token as accessible cookie
const setTokenCookies = (res, tokens) => {
  const accessMaxAge = durationToMs(JWT_EXPIRES_IN);
  const refreshMaxAge = durationToMs(REFRESH_TOKEN_EXPIRES_IN);

  res.cookie('fitcher_access_token', tokens.accessToken, {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: 'strict',
    path: '/',
    maxAge: accessMaxAge
  });

  res.cookie('fitcher_refresh_token', tokens.refreshToken, {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: 'strict',
    path: '/api/auth/refresh',
    maxAge: refreshMaxAge
  });

  if (tokens.csrfToken) {
    res.cookie('csrf_token', tokens.csrfToken, {
      httpOnly: false, // Must be readable by frontend JavaScript
      secure: IS_PRODUCTION,
      sameSite: 'strict',
      path: '/',
      maxAge: accessMaxAge
    });
  }
};

// Clear token cookies
const clearTokenCookies = (res) => {
  res.clearCookie('fitcher_access_token', {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: 'strict',
    path: '/'
  });

  res.clearCookie('fitcher_refresh_token', {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: 'strict',
    path: '/api/auth/refresh'
  });

  res.clearCookie('csrf_token', {
    httpOnly: false,
    secure: IS_PRODUCTION,
    sameSite: 'strict',
    path: '/'
  });
};

module.exports = {
  validateJWT,
  generateTokens,
  setTokenCookies,
  clearTokenCookies
};
