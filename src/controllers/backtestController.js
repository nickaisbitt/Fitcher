const HistoricalDataService = require('../services/historicalDataService');
const ParquetWriter = require('../services/parquetWriter');
const BacktestEngine = require('../services/backtestEngine');
const StrategyOptimizer = require('../services/strategyOptimizer');
const strategyFactory = require('../strategies/strategyFactory');
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const database = require('../utils/database');
const { v4: uuidv4 } = require('uuid');

const historicalDataService = new HistoricalDataService();
const parquetWriter = new ParquetWriter();

class BacktestController {
  /**
   * Get historical data from local storage or fetch from exchange
   * @param {string} pair - Trading pair
   * @param {string} timeframe - Timeframe
   * @param {number} limit - Number of candles
   * @param {string} exchange - Exchange to fetch from if local not available
   */
  async getHistoricalData(pair, timeframe, limit, exchange) {
    // Try local storage first
    try {
      const range = await parquetWriter.getAvailableRange(pair, timeframe);
      
      if (range && range.latest && range.earliest) {
        // Check if we have enough data
        const availableCount = range.totalCandles;
        
        if (availableCount >= limit) {
          // Calculate date range for the last 'limit' candles
          const endDate = range.latest;
          const startDate = new Date(endDate.getTime() - (limit * this.parseTimeframeMs(timeframe)));
          
          const candles = await parquetWriter.readRange(pair, timeframe, startDate, endDate);
          
          if (candles.length > 0) {
            logger.info(`Using local data: ${candles.length} candles from Parquet`);
            return candles.slice(-limit); // Return last 'limit' candles
          }
        }
      }
    } catch (error) {
      logger.warn(`Failed to read local data, falling back to CCXT:`, error.message);
    }

    // Fall back to fetching from exchange
    logger.info(`Fetching ${limit} candles from ${exchange}...`);
    const rawData = await historicalDataService.fetchOHLCV(exchange, pair, timeframe, null, limit);
    
    if (!rawData || rawData.length === 0) {
      throw new Error('No historical data available');
    }

    return rawData.map(candle => ({
      timestamp: candle[0] || candle.timestamp,
      open: candle[1] || candle.open,
      high: candle[2] || candle.high,
      low: candle[3] || candle.low,
      close: candle[4] || candle.close,
      volume: candle[5] || candle.volume
    }));
  }

  parseTimeframeMs(timeframe) {
    const units = {
      'm': 60 * 1000,
      'h': 60 * 60 * 1000,
      'd': 24 * 60 * 60 * 1000,
      'w': 7 * 24 * 60 * 60 * 1000,
      'M': 30 * 24 * 60 * 60 * 1000
    };

    const match = timeframe.match(/^(\d+)([mhdwM])$/);
    if (!match) return 60 * 60 * 1000; // Default 1h

    const [, amount, unit] = match;
    return parseInt(amount) * units[unit];
  }
  // POST /api/backtest/run
  runBacktest = asyncHandler(async (req, res) => {
    const {
      exchange = 'binance',  // Use Binance for historical data (better support)
      pair = 'BTC/USD',
      timeframe = '1h',
      limit = 300,
      strategyType = 'mean_reversion',
      strategyParams = {},
      backtestConfig = {}
    } = req.body || {};

    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 300, 50), 1000);

    logger.info('Running backtest', {
      userId: req.user?.userId,
      exchange,
      pair,
      timeframe,
      limit: safeLimit,
      strategyType
    });

    // Get historical data (local storage first, then CCXT)
    const rawData = await this.getHistoricalData(pair, timeframe, safeLimit, exchange);

    if (!rawData || rawData.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No historical data found',
        code: 'NO_DATA'
      });
    }

    const normalizedPair = pair.toUpperCase().replace('-', '/');
    const historicalData = rawData.map(candle => ({
      ...candle,
      pair: normalizedPair
    }));

    const strategy = strategyFactory.create(strategyType, strategyParams);
    const backtest = new BacktestEngine(backtestConfig);
    const results = await backtest.run(strategy, historicalData, { enableLogging: false });

    const prisma = database.getPrisma();
    const record = await prisma.backtestResult.create({
      data: {
        id: uuidv4(),
        userId: req.user.userId,
        type: 'RUN',
        exchange,
        pair: normalizedPair,
        timeframe,
        strategyType,
        strategyParams,
        backtestConfig,
        result: {
          summary: results.summary,
          trades: results.trades,
          equityCurve: results.equityCurve,
          signals: results.signals,
          drawdowns: results.drawdowns
        }
      }
    });

    res.json({
      success: true,
      data: {
        id: record.id,
        summary: results.summary,
        tradeCount: results.trades.length,
        equityPoints: results.equityCurve.length,
        signals: results.signals.length
      }
    });
  });

  // POST /api/backtest/optimize
  optimize = asyncHandler(async (req, res) => {
    const {
      exchange = 'kraken',
      pair = 'BTC/USD',
      timeframe = '1h',
      limit = 500,
      strategyType = 'mean_reversion',
      paramGrid = null,
      backtestConfig = {}
    } = req.body || {};

    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 500, 100), 2000);

    const rawData = await historicalDataService.fetchOHLCV(
      exchange,
      pair,
      timeframe,
      null,
      safeLimit
    );

    if (!rawData || rawData.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No historical data found',
        code: 'NO_DATA'
      });
    }

    const normalizedPair = pair.toUpperCase().replace('-', '/');
    const historicalData = rawData.map(candle => ({
      ...candle,
      pair: normalizedPair
    }));

    const strategy = strategyFactory.create(strategyType, {});
    const optimizer = new StrategyOptimizer();

    const defaultGrid = {
      mean_reversion: {
        bbPeriod: [14, 20, 30],
        bbStdDev: [1.5, 2, 2.5],
        rsiPeriod: [10, 14],
        rsiOverbought: [65, 70, 75],
        rsiOversold: [25, 30, 35]
      },
      momentum: {
        fastEma: [8, 12, 16],
        slowEma: [21, 26, 34],
        trailingStopPercent: [2, 3, 4]
      },
      grid: {
        gridLevels: [6, 8, 10],
        gridSpacing: [0.3, 0.5, 0.7],
        gridRange: [3, 5, 7]
      }
    };

    const grid = paramGrid || defaultGrid[strategyType] || defaultGrid.mean_reversion;

    const results = await optimizer.optimize(strategy, historicalData, grid, backtestConfig);

    const prisma = database.getPrisma();
    const record = await prisma.backtestResult.create({
      data: {
        id: uuidv4(),
        userId: req.user.userId,
        type: 'OPTIMIZE',
        exchange,
        pair: normalizedPair,
        timeframe,
        strategyType,
        strategyParams: {},
        backtestConfig,
        result: {
          bestParams: results.bestParams,
          bestScore: results.bestScore,
          aggregate: results.aggregate,
          splits: results.splits.map(s => ({
            split: s.split,
            trainScore: s.trainScore,
            testScore: s.testScore,
            testResult: s.testResult
          }))
        }
      }
    });

    res.json({
      success: true,
      data: {
        id: record.id,
        bestParams: results.bestParams,
        bestScore: results.bestScore,
        aggregate: results.aggregate,
        splits: results.splits.map(s => ({
          split: s.split,
          trainScore: s.trainScore,
          testScore: s.testScore,
          testResult: s.testResult
        }))
      }
    });
  });

  // GET /api/backtest/history
  history = asyncHandler(async (req, res) => {
    const {
      type,
      strategyType,
      include,
      page = 1,
      limit = 25,
      from,
      to
    } = req.query;

    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
    const safePage = Math.max(parseInt(page, 10) || 1, 1);
    const skip = (safePage - 1) * safeLimit;
    const includeFull = include === 'full';

    const createdAt = {};
    if (from) createdAt.gte = new Date(from);
    if (to) createdAt.lte = new Date(to);

    const prisma = database.getPrisma();
    const results = await prisma.backtestResult.findMany({
      where: {
        userId: req.user.userId,
        ...(type ? { type: type.toUpperCase() } : {}),
        ...(strategyType ? { strategyType } : {}),
        ...(Object.keys(createdAt).length ? { createdAt } : {})
      },
      orderBy: { createdAt: 'desc' },
      take: safeLimit,
      skip
    });

    const mapped = includeFull
      ? results
      : results.map((item) => ({
          id: item.id,
          userId: item.userId,
          type: item.type,
          exchange: item.exchange,
          pair: item.pair,
          timeframe: item.timeframe,
          strategyType: item.strategyType,
          strategyParams: item.strategyParams,
          backtestConfig: item.backtestConfig,
          createdAt: item.createdAt,
          summary: item.result?.summary || item.result || null
        }));

    res.json({
      success: true,
      data: {
        results: mapped,
        count: mapped.length,
        page: safePage,
        limit: safeLimit
      }
    });
  });

  // GET /api/backtest/history/:id
  historyById = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { include } = req.query;
    const includeFull = include === 'full';

    const prisma = database.getPrisma();
    const result = await prisma.backtestResult.findFirst({
      where: {
        id,
        userId: req.user.userId
      }
    });

    if (!result) {
      return res.status(404).json({
        success: false,
        error: 'Backtest result not found',
        code: 'BACKTEST_NOT_FOUND'
      });
    }

    res.json({
      success: true,
      data: includeFull
        ? result
        : {
            id: result.id,
            userId: result.userId,
            type: result.type,
            exchange: result.exchange,
            pair: result.pair,
            timeframe: result.timeframe,
            strategyType: result.strategyType,
            strategyParams: result.strategyParams,
            backtestConfig: result.backtestConfig,
            createdAt: result.createdAt,
            summary: result.result?.summary || result.result || null
          }
    });
  });
}

module.exports = new BacktestController();
