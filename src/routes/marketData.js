const express = require('express');
const marketDataController = require('../controllers/marketDataController');
const { validateJWT } = require('../middleware/auth');

const router = express.Router();

// All market data routes require authentication
router.use(validateJWT);

// GET /api/market/price/:pair - Get current price for a pair
router.get('/price/:pair', marketDataController.getPrice);

// GET /api/market/prices - Get all current prices
router.get('/prices', marketDataController.getAllPrices);

// GET /api/market/orderbook/:pair - Get order book for a pair
router.get('/orderbook/:pair', marketDataController.getOrderBook);

// GET /api/market/trades/:pair - Get recent trades for a pair
router.get('/trades/:pair', marketDataController.getRecentTrades);

// GET /api/market/aggregated/:pair - Get aggregated price across exchanges
router.get('/aggregated/:pair', marketDataController.getAggregatedPrice);

// GET /api/market/status - Get market data status
router.get('/status', marketDataController.getStatus);

// POST /api/market/subscribe - Subscribe to real-time market data
router.post('/subscribe', marketDataController.subscribe);

// POST /api/market/unsubscribe - Unsubscribe from real-time market data
router.post('/unsubscribe', marketDataController.unsubscribe);

// GET /api/market/pairs - Get available trading pairs
router.get('/pairs', marketDataController.getAvailablePairs);

// GET /api/market/exchanges - Get available exchanges
router.get('/exchanges', marketDataController.getAvailableExchanges);

module.exports = router;