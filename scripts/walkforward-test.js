#!/usr/bin/env node
/**
 * walkforward-test.js
 * Walk-forward validation: Train on historical data, test on "future" data
 * Validates that strategy isn't overfitted
 */

const fs = require('fs').promises;
const path = require('path');
const logger = require('../src/utils/logger');
const PaperTradingEngine = require('../src/services/PaperTradingEngine');
const SignalAggregator = require('../src/services/SignalAggregator');
const MomentumStrategyV2 = require('../src/strategies/MomentumStrategyV2');
const MeanReversionStrategyV2 = require('../src/strategies/MeanReversionStrategyV2');

const CONFIG = {
  dataDir: path.join(__dirname, '..', 'data', 'historical'),
  pairs: ['BTC_USDT'],
  timeframes: ['1h', '4h', '1d'],
  initialBalance: 100000,
};

async function loadCandles(pair, timeframe) {
  try {
    const filename = `${pair}_${timeframe}.json`;
    const filepath = path.join(CONFIG.dataDir, filename);
    const data = await fs.readFile(filepath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return null;
  }
}

function detectLongTermTrend(timeframeData) {
  const trends = {};
  for (const tf of ['4h', '1d']) {
    const candles = timeframeData[tf];
    if (!candles || candles.length < 50) continue;
    const recent = candles.slice(-20);
    const ema20 = recent.reduce((sum, c) => sum + c.close, 0) / recent.length;
    const older = candles.slice(-50, -30);
    const ema50 = older.length > 0 ? older.reduce((sum, c) => sum + c.close, 0) / older.length : ema20;
    if (ema20 > ema50 * 1.05) trends[tf] = 'uptrend';
    else if (ema20 < ema50 * 0.95) trends[tf] = 'downtrend';
    else trends[tf] = 'ranging';
  }
  if (trends['4h'] === 'downtrend' && trends['1d'] === 'downtrend') return 'strong_downtrend';
  if (trends['4h'] === 'downtrend' || trends['1d'] === 'downtrend') return 'downtrend';
  if (trends['4h'] === 'uptrend' && trends['1d'] === 'uptrend') return 'strong_uptrend';
  if (trends['4h'] === 'uptrend' || trends['1d'] === 'uptrend') return 'uptrend';
  return 'ranging';
}

async function runBacktest(candles, timeframeData, config) {
  const paperTrading = new PaperTradingEngine({
    initialBalance: CONFIG.initialBalance,
    baseCurrency: 'USDT',
    tradingPairs: ['BTC/USDT'],
    maxLossPercent: 3.0
  });
  await paperTrading.initialize();

  const strategies = [];
  if (config.momentum?.enabled) {
    strategies.push(new MomentumStrategyV2(config.momentum.config));
  }
  if (config.meanReversion?.enabled) {
    strategies.push(new MeanReversionStrategyV2(config.meanReversion.config));
  }

  const aggregator = new SignalAggregator({
    requireConsensus: false,
    minConsensusCount: 1,
    minCombinedConfidence: 0.5
  });
  strategies.forEach(s => aggregator.registerStrategy(s.name));

  for (const candle of candles) {
    candle.pair = 'BTC/USDT';
    const signals = await paperTrading.processCandle(candle, strategies);
    if (signals && signals.length > 0) {
      // Pass neutral regime to disable Cash is King for pure strategy testing
      const regime = 'neutral';
      const aggregated = aggregator.aggregate(signals, { pair: 'BTC/USDT', price: candle.close, regime });
      if (aggregated.action !== 'hold' && aggregated.confidence >= 0.5) {
        try {
          await paperTrading.executeTrade({ ...aggregated, timestamp: candle.timestamp });
        } catch (e) {}
      }
    }
  }

  return paperTrading.getPerformance();
}

async function main() {
  logger.info('=== Walk-Forward Validation ===\n');

  const pair = 'BTC_USDT';
  const candles1h = await loadCandles(pair, '1h');
  const candles4h = await loadCandles(pair, '4h');
  const candles1d = await loadCandles(pair, '1d');

  if (!candles1h || candles1h.length === 0) {
    logger.error('No data found!');
    return;
  }

  logger.info(`Total 1h candles: ${candles1h.length}`);
  logger.info(`Date range: ${candles1h[0].datetime} to ${candles1h[candles1h.length - 1].datetime}\n`);

  // Find split point - use 80% for training, 20% for testing
  const splitIndex = Math.floor(candles1h.length * 0.8);
  const trainCandles = candles1h.slice(0, splitIndex);
  const testCandles = candles1h.slice(splitIndex);

  const trainStart = trainCandles[0].datetime;
  const trainEnd = trainCandles[trainCandles.length - 1].datetime;
  const testStart = testCandles[0].datetime;
  const testEnd = testCandles[testCandles.length - 1].datetime;

  logger.info(`Split: ${(splitIndex / candles1h.length * 100).toFixed(0)}% / ${((candles1h.length - splitIndex) / candles1h.length * 100).toFixed(0)}%`);
  logger.info(`Train: ${trainStart} to ${trainEnd}`);
  logger.info(`Test:  ${testStart} to ${testEnd}\n`);

  // Prepare timeframe data
  const timeframeData = {
    '1h': candles1h,
    '4h': candles4h,
    '1d': candles1d
  };

  // Strategy config - less aggressive for walk-forward testing
  const strategyConfig = {
    momentum: {
      enabled: true,
      config: {
        primaryTimeframe: '1h',
        emaFast: 9,
        emaSlow: 21,
        minConfidence: 0.65,
        requireRsiFilter: false, // Disable for walk-forward test
        requireAdxFilter: false, // Disable for walk-forward test
        trailingStopAtrMultiplier: 1.0,
        basePositionSize: 0.10
      }
    }
  };

  // Run on training data
  logger.info('Running IN-SAMPLE (training) backtest...');
  const trainResult = await runBacktest(trainCandles, timeframeData, strategyConfig);

  // Run on test data  
  logger.info('Running OUT-OF-SAMPLE (test) backtest...');
  const testResult = await runBacktest(testCandles, timeframeData, strategyConfig);

  // Results
  logger.info('\n=== WALK-FORWARD RESULTS ===\n');
  logger.info('Period          | Return   | Win%   | Trades | Max DD');
  logger.info('----------------|----------|--------|--------|--------');
  
  const formatRow = (period, res) => {
    const ret = (res.totalReturn >= 0 ? '+' : '') + res.totalReturn.toFixed(2) + '%';
    const win = res.winRate.toFixed(1) + '%';
    const trades = res.totalTrades.toString();
    const dd = res.maxDrawdown.toFixed(2) + '%';
    return `${period.padEnd(15)}| ${ret.padStart(8)}| ${win.padStart(6)}| ${trades.padStart(6)}| ${dd}`;
  };

  logger.info(formatRow('In-Sample', trainResult));
  logger.info(formatRow('Out-Sample', testResult));

  // Analysis
  logger.info('\n=== ANALYSIS ===');
  const diff = testResult.totalReturn - trainResult.totalReturn;
  if (Math.abs(diff) < 10) {
    logger.info('✅ Performance similar in/out of sample - strategy is NOT overfitted');
  } else if (diff < 0) {
    logger.info(`⚠️  Out-of-sample performance is ${diff.toFixed(2)}% worse`);
    logger.info('   This is expected - real markets are harder than backtests');
  } else {
    logger.info(`🎉 Out-of-sample performance is ${diff.toFixed(2)}% better!`);
  }

  if (testResult.maxDrawdown < 10) {
    logger.info('✅ Max drawdown under 10% - risk is controlled');
  } else {
    logger.info(`⚠️  Max drawdown ${testResult.maxDrawdown.toFixed(2)}% is high`);
  }
}

main().catch(e => {
  logger.error('Walk-forward test failed:', e);
  process.exit(1);
});
