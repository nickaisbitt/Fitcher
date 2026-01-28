const express = require('express');
const tradingController = require('../controllers/tradingController');
const { validateJWT } = require('../middleware/auth');

const router = express.Router();

// All trading routes require authentication
router.use(validateJWT);

// POST /api/trading/orders - Create new order
router.post('/orders',
  tradingController.constructor.getOrderValidationRules(),
  tradingController.constructor.handleValidationErrors,
  tradingController.createOrder
);

// GET /api/trading/orders - Get user's orders
router.get('/orders', tradingController.getOrders);

// GET /api/trading/orders/:orderId - Get specific order
router.get('/orders/:orderId', tradingController.getOrder);

// PUT /api/trading/orders/:orderId - Update order
router.put('/orders/:orderId', tradingController.updateOrder);

// DELETE /api/trading/orders/:orderId - Cancel order
router.delete('/orders/:orderId', tradingController.cancelOrder);

// GET /api/trading/stats - Get trading statistics
router.get('/stats', tradingController.getTradingStats);

// GET /api/trading/active - Get active orders
router.get('/active', tradingController.getActiveOrders);

// POST /api/trading/validate - Validate order without creating
router.post('/validate',
  tradingController.constructor.getOrderValidationRules(),
  tradingController.constructor.handleValidationErrors,
  tradingController.validateOrder
);

module.exports = router;