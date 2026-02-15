const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const { generateTokens, setTokenCookies, clearTokenCookies } = require('../middleware/auth');
const database = require('../utils/database');
const logger = require('../utils/logger');

const router = express.Router();

// Strict rate limiting for auth endpoints
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: { success: false, error: 'Too many login attempts, please try again in 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false,
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  message: { success: false, error: 'Too many registration attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Validation helpers
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array().map(e => e.msg)
    });
  }
  next();
};

// Register new user
router.post('/signup',
  registerLimiter,
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  handleValidationErrors,
  async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }

    const prisma = database.getPrisma();
    
    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        error: 'User already exists'
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = await prisma.user.create({
      data: {
        id: uuidv4(),
        email,
        password: hashedPassword,
        name: name || email.split('@')[0],
        createdAt: new Date(),
        updatedAt: new Date()
      }
    });

    // Generate tokens and set cookies
    const tokens = generateTokens(user.id, user.email);
    setTokenCookies(res, tokens);

    res.status(201).json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name
        },
        ...tokens
      }
    });
  } catch (error) {
    logger.error('Signup error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Login user
router.post('/login',
  loginLimiter,
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required'),
  handleValidationErrors,
  async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }

    const prisma = database.getPrisma();

    // Find user
    const user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);

    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }

    // Generate tokens and set cookies
    const tokens = generateTokens(user.id, user.email);
    setTokenCookies(res, tokens);

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name
        },
        ...tokens
      }
    });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Refresh token
router.post('/refresh', async (req, res) => {
  try {
    // Accept refresh token from body or httpOnly cookie
    const refreshToken = req.body.refreshToken || req.cookies?.fitcher_refresh_token;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        error: 'Refresh token required'
      });
    }

    // Verify refresh token using the dedicated refresh secret
    const decoded = jwt.verify(refreshToken, config.JWT_REFRESH_SECRET);

    if (decoded.type !== 'refresh') {
      return res.status(401).json({
        success: false,
        error: 'Invalid token type'
      });
    }

    // Hash the old refresh token for revocation tracking
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    logger.info(`Refresh token rotated — revoked token hash: ${tokenHash}, userId: ${decoded.userId}`);
    // TODO: Store revocation record in Prisma (e.g. RevokedToken table)

    // Generate new tokens and set cookies
    const tokens = generateTokens(decoded.userId, decoded.email);
    setTokenCookies(res, tokens);

    res.json({
      success: true,
      data: tokens
    });
  } catch (error) {
    logger.error('Token refresh error:', error);
    res.status(401).json({
      success: false,
      error: 'Invalid refresh token'
    });
  }
});

// Logout — clear token cookies
router.post('/logout', (req, res) => {
  clearTokenCookies(res);
  res.json({ success: true });
});

module.exports = router;
