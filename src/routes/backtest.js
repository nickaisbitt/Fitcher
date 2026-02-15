const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const backtestController = require('../controllers/backtestController');
const { validateJWT } = require('../middleware/auth');

const router = express.Router();

// All backtest routes require authentication
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

const validTimeframes = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'];
const validStrategies = ['momentum', 'mean_reversion', 'grid'];

// POST /api/backtest/run - Run a backtest
router.post('/run',
  body('pair').optional().isString().matches(/^[A-Z]{2,10}[\/\-][A-Z]{2,10}$/i).withMessage('Invalid pair format (e.g., BTC/USD)'),
  body('timeframe').optional().isIn(validTimeframes).withMessage(`Timeframe must be one of: ${validTimeframes.join(', ')}`),
  body('strategyType').optional().isIn(validStrategies).withMessage(`Strategy must be one of: ${validStrategies.join(', ')}`),
  body('limit').optional().isInt({ min: 50, max: 10000 }).withMessage('Limit must be between 50 and 10000'),
  body('exchange').optional().isString().isLength({ min: 2, max: 20 }),
  handleValidationErrors,
  backtestController.runBacktest
);

// POST /api/backtest/optimize - Run walk-forward optimization
router.post('/optimize',
  body('pair').optional().isString().matches(/^[A-Z]{2,10}[\/\-][A-Z]{2,10}$/i).withMessage('Invalid pair format'),
  body('timeframe').optional().isIn(validTimeframes).withMessage(`Invalid timeframe`),
  body('strategyType').optional().isIn(validStrategies).withMessage(`Invalid strategy type`),
  body('limit').optional().isInt({ min: 100, max: 10000 }).withMessage('Limit must be between 100 and 10000'),
  handleValidationErrors,
  backtestController.optimize
);

// GET /api/backtest/history - Get backtest history
router.get('/history',
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('type').optional().isIn(['RUN', 'OPTIMIZE']).withMessage('Type must be RUN or OPTIMIZE'),
  handleValidationErrors,
  backtestController.history
);

// GET /api/backtest/history/:id - Get backtest result by ID
router.get('/history/:id',
  param('id').isUUID().withMessage('Invalid backtest ID'),
  handleValidationErrors,
  backtestController.historyById
);

module.exports = router;
