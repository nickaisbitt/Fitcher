const express = require('express');
const { param, query, body, validationResult } = require('express-validator');
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

const validatePair = param('pair')
  .isString()
  .matches(/^[A-Z0-9]{2,10}[\/\-][A-Z0-9]{2,10}$/i)
  .withMessage('Invalid pair format (e.g., BTC/USD)');

const validateExchange = query('exchange')
  .optional()
  .isString()
  .isLength({ min: 2, max: 20 })
  .withMessage('Invalid exchange format');

// GET /api/market/price/:pair - Get current price for a pair
router.get('/price/:pair',
  validatePair,
  validateExchange,
  handleValidationErrors,
  marketDataController.getPrice
);

// GET /api/market/prices - Get all current prices
router.get('/prices', marketDataController.getAllPrices);

// GET /api/market/orderbook/:pair - Get order book for a pair
router.get('/orderbook/:pair',
  validatePair,
  validateExchange,
  query('depth').optional().isInt({ min: 1, max: 1000 }).withMessage('Depth must be between 1 and 1000'),
  handleValidationErrors,
  marketDataController.getOrderBook
);

// GET /api/market/trades/:pair - Get recent trades for a pair
router.get('/trades/:pair',
  validatePair,
  validateExchange,
  query('limit').optional().isInt({ min: 1, max: 1000 }).withMessage('Limit must be between 1 and 1000'),
  handleValidationErrors,
  marketDataController.getRecentTrades
);

// GET /api/market/aggregated/:pair - Get aggregated price across exchanges
router.get('/aggregated/:pair',
  validatePair,
  handleValidationErrors,
  marketDataController.getAggregatedPrice
);

// GET /api/market/status - Get market data status
router.get('/status', marketDataController.getStatus);

// POST /api/market/subscribe - Subscribe to real-time market data
router.post('/subscribe',
  body('type').isString().isIn(['ticker', 'orderbook', 'trades']).withMessage('Invalid subscription type'),
  body('pair').isString().matches(/^[A-Z0-9]{2,10}[\/\-][A-Z0-9]{2,10}$/i).withMessage('Invalid pair format'),
  handleValidationErrors,
  marketDataController.subscribe
);

// POST /api/market/unsubscribe - Unsubscribe from real-time market data
router.post('/unsubscribe',
  body('type').isString().isIn(['ticker', 'orderbook', 'trades']).withMessage('Invalid subscription type'),
  body('pair').isString().matches(/^[A-Z0-9]{2,10}[\/\-][A-Z0-9]{2,10}$/i).withMessage('Invalid pair format'),
  handleValidationErrors,
  marketDataController.unsubscribe
);

// GET /api/market/pairs - Get available trading pairs
router.get('/pairs', marketDataController.getAvailablePairs);

// GET /api/market/exchanges - Get available exchanges
router.get('/exchanges', marketDataController.getAvailableExchanges);

module.exports = router;
