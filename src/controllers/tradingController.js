const { body, validationResult } = require('express-validator');
const OrderManager = require('../services/orderManager');
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

class TradingController {
  constructor() {
    this.orderManager = new OrderManager();
  }

  // Validation middleware
  static handleValidationErrors(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: errors.array()
      });
    }
    next();
  }

  // Validation rules for order creation
  static getOrderValidationRules() {
    return [
      body('exchange')
        .notEmpty()
        .withMessage('Exchange is required')
        .isIn(['kraken', 'binance', 'coinbase'])
        .withMessage('Exchange must be one of: kraken, binance, coinbase'),
      body('pair')
        .notEmpty()
        .withMessage('Trading pair is required')
        .matches(/^[A-Z]{2,10}[\/\-][A-Z]{2,10}$/i)
        .withMessage('Invalid pair format. Expected: BTC/USD or BTC-USD'),
      body('type')
        .notEmpty()
        .withMessage('Order type is required')
        .isIn(['market', 'limit', 'stop', 'stop_limit', 'oco'])
        .withMessage('Order type must be one of: market, limit, stop, stop_limit, oco'),
      body('side')
        .notEmpty()
        .withMessage('Order side is required')
        .isIn(['buy', 'sell'])
        .withMessage('Order side must be one of: buy, sell'),
      body('amount')
        .notEmpty()
        .withMessage('Order amount is required')
        .isFloat({ gt: 0 })
        .withMessage('Amount must be greater than 0'),
      body('price')
        .optional()
        .isFloat({ gt: 0 })
        .withMessage('Price must be greater than 0'),
      body('stopPrice')
        .optional()
        .isFloat({ gt: 0 })
        .withMessage('Stop price must be greater than 0'),
      body('timeInForce')
        .optional()
        .isIn(['GTC', 'IOC', 'FOK'])
        .withMessage('Time in force must be one of: GTC, IOC, FOK')
    ];
  }

  // POST /api/trading/orders - Create new order
  createOrder = asyncHandler(async (req, res) => {
    const userId = req.user.userId;
    const orderData = {
      userId,
      exchange: req.body.exchange,
      pair: req.body.pair.toUpperCase(),
      type: req.body.type.toLowerCase(),
      side: req.body.side.toLowerCase(),
      amount: parseFloat(req.body.amount),
      price: req.body.price ? parseFloat(req.body.price) : null,
      stopPrice: req.body.stopPrice ? parseFloat(req.body.stopPrice) : null,
      timeInForce: req.body.timeInForce || 'GTC',
      notes: req.body.notes || '',
      strategyId: req.body.strategyId || null
    };

    logger.info(`Creating order for user ${userId}:`, orderData);

    const result = await this.orderManager.createOrder(orderData);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.status(201).json(result);
  });

  // GET /api/trading/orders - Get user's orders
  getOrders = asyncHandler(async (req, res) => {
    const userId = req.user.userId;
    const filters = {
      status: req.query.status,
      exchange: req.query.exchange,
      pair: req.query.pair?.toUpperCase(),
      side: req.query.side,
      type: req.query.type
    };

    // Remove undefined filters
    Object.keys(filters).forEach(key => {
      if (filters[key] === undefined) delete filters[key];
    });

    const orders = await this.orderManager.getUserOrders(userId, filters);

    res.json({
      success: true,
      data: {
        orders,
        count: orders.length,
        filters
      }
    });
  });

  // GET /api/trading/orders/:orderId - Get specific order
  getOrder = asyncHandler(async (req, res) => {
    const { orderId } = req.params;
    const userId = req.user.userId;

    const order = await this.orderManager.getOrder(orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found',
        code: 'ORDER_NOT_FOUND'
      });
    }

    // Check if order belongs to user
    if (order.userId !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
        code: 'ACCESS_DENIED'
      });
    }

    res.json({
      success: true,
      data: order.getSummary()
    });
  });

  // PUT /api/trading/orders/:orderId - Update order
  updateOrder = asyncHandler(async (req, res) => {
    const { orderId } = req.params;
    const userId = req.user.userId;

    // Get order first to verify ownership
    const order = await this.orderManager.getOrder(orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found',
        code: 'ORDER_NOT_FOUND'
      });
    }

    if (order.userId !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
        code: 'ACCESS_DENIED'
      });
    }

    const updates = {};
    if (req.body.price !== undefined) updates.price = req.body.price;
    if (req.body.amount !== undefined) updates.amount = req.body.amount;
    if (req.body.notes !== undefined) updates.notes = req.body.notes;

    const result = await this.orderManager.updateOrder(orderId, updates);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);
  });

  // DELETE /api/trading/orders/:orderId - Cancel order
  cancelOrder = asyncHandler(async (req, res) => {
    const { orderId } = req.params;
    const userId = req.user.userId;

    // Get order first to verify ownership
    const order = await this.orderManager.getOrder(orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found',
        code: 'ORDER_NOT_FOUND'
      });
    }

    if (order.userId !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
        code: 'ACCESS_DENIED'
      });
    }

    const result = await this.orderManager.cancelOrder(orderId);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);
  });

  // GET /api/trading/stats - Get trading statistics
  getTradingStats = asyncHandler(async (req, res) => {
    const userId = req.user.userId;

    const stats = await this.orderManager.getOrderStats(userId);

    res.json({
      success: true,
      data: stats
    });
  });

  // GET /api/trading/active - Get active orders count
  getActiveOrders = asyncHandler(async (req, res) => {
    const userId = req.user.userId;

    const orders = await this.orderManager.getUserOrders(userId);
    const activeOrders = orders.filter(o => ['pending', 'open', 'partial'].includes(o.status));

    res.json({
      success: true,
      data: {
        activeOrders,
        count: activeOrders.length
      }
    });
  });

  // POST /api/trading/validate - Validate order without creating
  validateOrder = asyncHandler(async (req, res) => {
    const OrderValidator = require('../services/orderValidator');
    const validator = new OrderValidator();

    const orderData = {
      exchange: req.body.exchange,
      pair: req.body.pair?.toUpperCase(),
      type: req.body.type?.toLowerCase(),
      side: req.body.side?.toLowerCase(),
      amount: parseFloat(req.body.amount),
      price: req.body.price ? parseFloat(req.body.price) : null,
      stopPrice: req.body.stopPrice ? parseFloat(req.body.stopPrice) : null,
      timeInForce: req.body.timeInForce || 'GTC'
    };

    const validation = validator.validate(orderData);

    res.json({
      success: validation.valid,
      valid: validation.valid,
      errors: validation.errors,
      warnings: validation.warnings,
      data: orderData
    });
  });
}

// Create singleton instance
const tradingController = new TradingController();

module.exports = tradingController;