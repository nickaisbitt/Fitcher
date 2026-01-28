const express = require('express');
const config = require('../config');

const router = express.Router();

// Get public configuration
router.get('/', (req, res) => {
  res.json({
    success: true,
    data: {
      version: '2.0.0',
      environment: config.NODE_ENV,
      features: {
        trading: true,
        marketData: true,
        aiAnalysis: true
      }
    }
  });
});

module.exports = router;
