const express = require('express');
const { param, body, query, validationResult } = require('express-validator');
const marketDataController = require('../controllers/marketDataController');
const { validateJWT } = require('../middleware/auth');

const router = express.Router();

// All market data routes require authentication
router.use(validateJWT);

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

// GET /api/market/price/:pair - Get current price for a pair
router.get('/price/:pair',
  param('pair').matches(/^[A-Z0-9]{2,10}[\/\-][A-Z0-9]{2,10}$/i).withMessage('Invalid pair format'),
  query('exchange').optional().isString(),
  handleValidationErrors,
  marketDataController.getPrice
);

// GET /api/market/prices - Get all current prices
router.get('/prices', marketDataController.getAllPrices);

// GET /api/market/orderbook/:pair - Get order book for a pair
router.get('/orderbook/:pair',
  param('pair').matches(/^[A-Z0-9]{2,10}[\/\-][A-Z0-9]{2,10}$/i).withMessage('Invalid pair format'),
  query('exchange').optional().isString(),
  query('depth').optional().isInt({ min: 1, max: 1000 }),
  handleValidationErrors,
  marketDataController.getOrderBook
);

// GET /api/market/trades/:pair - Get recent trades for a pair
router.get('/trades/:pair',
  param('pair').matches(/^[A-Z0-9]{2,10}[\/\-][A-Z0-9]{2,10}$/i).withMessage('Invalid pair format'),
  query('exchange').optional().isString(),
  query('limit').optional().isInt({ min: 1, max: 1000 }),
  handleValidationErrors,
  marketDataController.getRecentTrades
);

// GET /api/market/aggregated/:pair - Get aggregated price across exchanges
router.get('/aggregated/:pair',
  param('pair').matches(/^[A-Z0-9]{2,10}[\/\-][A-Z0-9]{2,10}$/i).withMessage('Invalid pair format'),
  handleValidationErrors,
  marketDataController.getAggregatedPrice
);

// GET /api/market/status - Get market data status
router.get('/status', marketDataController.getStatus);

// POST /api/market/subscribe - Subscribe to real-time market data
router.post('/subscribe',
  body('pair').matches(/^[A-Z0-9]{2,10}[\/\-][A-Z0-9]{2,10}$/i).withMessage('Invalid pair format'),
  body('type').isString().notEmpty(),
  handleValidationErrors,
  marketDataController.subscribe
);

// POST /api/market/unsubscribe - Unsubscribe from real-time market data
router.post('/unsubscribe',
  body('pair').matches(/^[A-Z0-9]{2,10}[\/\-][A-Z0-9]{2,10}$/i).withMessage('Invalid pair format'),
  body('type').isString().notEmpty(),
  handleValidationErrors,
  marketDataController.unsubscribe
);

// GET /api/market/pairs - Get available trading pairs
router.get('/pairs', marketDataController.getAvailablePairs);

// GET /api/market/exchanges - Get available exchanges
router.get('/exchanges', marketDataController.getAvailableExchanges);

module.exports = router;