const express = require('express');
const backtestController = require('../controllers/backtestController');
const { validateJWT } = require('../middleware/auth');

const router = express.Router();

// All backtest routes require authentication
router.use(validateJWT);

// POST /api/backtest/run - Run a backtest
router.post('/run', backtestController.runBacktest);

// POST /api/backtest/optimize - Run walk-forward optimization
router.post('/optimize', backtestController.optimize);

// GET /api/backtest/history - Get backtest history
router.get('/history', backtestController.history);

// GET /api/backtest/history/:id - Get backtest result by ID
router.get('/history/:id', backtestController.historyById);

module.exports = router;
