const express = require('express');
const logger = require('../utils/logger');

const router = express.Router();

// Get user profile
router.get('/profile', async (req, res) => {
  try {
    // req.user is set by validateJWT middleware
    const userId = req.user.userId;
    
    res.json({
      success: true,
      data: {
        userId,
        email: req.user.email,
        message: 'Profile endpoint - extend with database query'
      }
    });
  } catch (error) {
    logger.error('Profile error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Get API keys
router.get('/keys', async (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        message: 'API keys endpoint - implement with encrypted storage'
      }
    });
  } catch (error) {
    logger.error('API keys error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

module.exports = router;
