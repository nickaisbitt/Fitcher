#!/usr/bin/env node
/**
 * backtest-runner.js
 * Runs backtests on historical data with paper trading simulation
 * Tests all strategies and generates performance reports
 */

const fs = require('fs').promises;
const path = require('path');
const logger = require('../src/utils/logger');
const PaperTradingEngine = require('../src/services/PaperTradingEngine');
const SignalAggregator = require('../src/services/SignalAggregator');
const MarketRegimeDetector = require('../src/services/MarketRegimeDetector');

// Strategies
const MomentumStrategyV2 = require('../src/strategies/MomentumStrategyV2');
const MeanReversionStrategyV2 = require('../src/strategies/MeanReversionStrategyV2');

// Configuration
const CONFIG = {
  dataDir: path.join(__dirname, '..', 'data', 'historical'),
  pairs: ['BTC_USDT', 'ETH_USDT'], // File naming format
  timeframes: ['1h', '4h', '1d'], // Need multiple timeframes for Cash is King
  initialBalance: 100000,
  baseCurrency: 'USDT',
  
  // Test periods (use last 6 months for initial testing)
  testStartDays: 180, // 6 months
  
  // Strategy configs
  strategies: {
    momentum: {
      enabled: true,
      config: {
        primaryTimeframe: '1h',
        minConfidence: 0.65,
        basePositionSize: 0.10
      }
    },
    meanReversion: {
      enabled: true,
      config: {
        primaryTimeframe: '1h',
        minConfidence: 0.60,
        basePositionSize: 0.08
      }
    }
  },
  
  // Aggregation config
  aggregation: {
    requireConsensus: true,
    minConsensusCount: 1, // Allow single strategy for testing
    minCombinedConfidence: 0.65
  }
};

/**
 * Load historical candle data
 */
async function loadCandles(pair, timeframe) {
  try {
    const filename = `${pair}_${timeframe}.json`;
    const filepath = path.join(CONFIG.dataDir, filename);
    
    logger.info(`Loading ${filename}...`);
    const data = await fs.readFile(filepath, 'utf8');
    const candles = JSON.parse(data);
    
    logger.info(`  Loaded ${candles.length} candles`);
    return candles;
  } catch (error) {
    logger.error(`Failed to load ${pair} ${timeframe}:`, error.message);
    return null;
  }
}

/**
 * Detect long-term trend from higher timeframes
 * Returns: 'strong_downtrend' | 'downtrend' | 'ranging' | 'uptrend' | 'strong_uptrend'
 */
function detectLongTermTrend(timeframeData, currentTime) {
  const trends = {};
  
  for (const tf of ['4h', '1d']) {
    const candles = timeframeData[tf];
    if (!candles || candles.length < 50) continue;
    
    // Get recent candles (last 20)
    const recent = candles.slice(-20);
    const ema20 = recent.reduce((sum, c) => sum + c.close, 0) / recent.length;
    const older = candles.slice(-50, -30);
    const ema50 = older.length > 0 ? older.reduce((sum, c) => sum + c.close, 0) / older.length : ema20;
    
    // Simple trend detection
    if (ema20 > ema50 * 1.05) trends[tf] = 'uptrend';
    else if (ema20 < ema50 * 0.95) trends[tf] = 'downtrend';
    else trends[tf] = 'ranging';
  }
  
  // If both 4h and 1d agree on downtrend, it's a bear market
  if (trends['4h'] === 'downtrend' && trends['1d'] === 'downtrend') {
    return 'strong_downtrend';
  }
  if (trends['4h'] === 'downtrend' || trends['1d'] === 'downtrend') {
    return 'downtrend';
  }
  if (trends['4h'] === 'uptrend' && trends['1d'] === 'uptrend') {
    return 'strong_uptrend';
  }
  if (trends['4h'] === 'uptrend' || trends['1d'] === 'uptrend') {
    return 'uptrend';
  }
  
  return 'ranging';
}

/**
 * Run backtest for a single pair
 */
async function runBacktest(pair, candles, timeframeData = {}) {
  logger.info(`\n=== Backtesting ${pair} ===`);
  logger.info(`Candles: ${candles.length}`);
  logger.info(`Period: ${candles[0].datetime} to ${candles[candles.length - 1].datetime}`);
  logger.info(`Timeframes: ${Object.keys(timeframeData).join(', ')}`);
  
  // Initialize paper trading
  const paperTrading = new PaperTradingEngine({
    initialBalance: CONFIG.initialBalance,
    baseCurrency: CONFIG.baseCurrency,
    tradingPairs: [pair.replace('_', '/')]
  });
  await paperTrading.initialize();
  
  // Initialize strategies
  const strategies = [];
  
  if (CONFIG.strategies.momentum.enabled) {
    const momentum = new MomentumStrategyV2(CONFIG.strategies.momentum.config);
    strategies.push(momentum);
    logger.info('  Strategy: Momentum v2');
  }
  
  if (CONFIG.strategies.meanReversion.enabled) {
    const meanReversion = new MeanReversionStrategyV2(CONFIG.strategies.meanReversion.config);
    strategies.push(meanReversion);
    logger.info('  Strategy: Mean Reversion v2');
  }
  
  // Initialize signal aggregator and regime detector
  const aggregator = new SignalAggregator(CONFIG.aggregation);
  const regimeDetector = new MarketRegimeDetector();
  strategies.forEach(s => aggregator.registerStrategy(s.name));
  
  // Process candles
  let processedCount = 0;
  let signalCount = 0;
  let tradeCount = 0;
  
  logger.info('\nProcessing candles...');
  
  for (const candle of candles) {
    // Ensure pair is set on the candle for V2 strategies
    const currentPair = pair.replace('_', '/');
    candle.pair = currentPair;

    // Update paper trading
    const signals = await paperTrading.processCandle(candle, strategies);
    
    if (signals && signals.length > 0) {
      signalCount += signals.length;
      
      // Get long-term regime from higher timeframes (Cash is King)
      const regime = detectLongTermTrend(timeframeData, candle.timestamp);

      // Aggregate signals
      const aggregated = aggregator.aggregate(signals, {
        pair: currentPair,
        price: candle.close,
        regime: regime
      });
      
      // Execute if actionable
      if (aggregated.action !== 'hold' && aggregated.confidence >= CONFIG.aggregation.minCombinedConfidence) {
        try {
          const trade = await paperTrading.executeTrade({
            ...aggregated,
            timestamp: candle.timestamp
          });
          
          // Update strategies with the trade result so they stay in sync
          for (const strategy of strategies) {
            if (typeof strategy.recordTrade === 'function') {
              strategy.recordTrade(trade);
            } else {
              // Manual sync for V2 strategies if recordTrade isn't standard
              strategy.position = trade.side === 'buy' ? 
                { amount: trade.amount, price: trade.price, type: 'long' } : 
                null;
            }
          }
          
          tradeCount++;
        } catch (error) {
          logger.warn(`  Trade failed: ${error.message}`);
        }
      }
    }
    
    processedCount++;
    
    // Progress update
    if (processedCount % 1000 === 0) {
      const progress = (processedCount / candles.length) * 100;
      const portfolio = paperTrading.getPortfolioValue();
      const pnl = portfolio - CONFIG.initialBalance;
      logger.info(`  ${progress.toFixed(1)}% | Signals: ${signalCount} | Trades: ${tradeCount} | P&L: $${pnl.toFixed(2)}`);
    }
  }
  
  // Get results
  const performance = paperTrading.getPerformance();
  
  logger.info(`\n--- Results for ${pair} ---`);
  logger.info(`Total Return: ${performance.totalReturn.toFixed(2)}%`);
  logger.info(`Total Trades: ${performance.totalTrades}`);
  logger.info(`Win Rate: ${performance.winRate.toFixed(1)}%`);
  logger.info(`Max Drawdown: ${performance.maxDrawdown.toFixed(2)}%`);
  logger.info(`Sharpe Ratio: ${performance.sharpeRatio.toFixed(2)}`);
  logger.info(`Final Value: $${performance.currentValue.toFixed(2)}`);
  
  return {
    pair,
    performance,
    signalCount,
    tradeCount,
    processedCount
  };
}

/**
 * Generate summary report
 */
async function generateReport(results) {
  logger.info('\n\n=== BACKTEST SUMMARY ===\n');
  
  for (const result of results) {
    logger.info(`${result.pair}:`);
    logger.info(`  Return: ${result.performance.totalReturn.toFixed(2)}% ($${result.performance.totalReturnUsd.toFixed(2)})`);
    logger.info(`  Trades: ${result.tradeCount} (from ${result.signalCount} signals)`);
    logger.info(`  Win Rate: ${result.performance.winRate.toFixed(1)}%`);
    logger.info(`  Max DD: ${result.performance.maxDrawdown.toFixed(2)}%`);
    logger.info(`  Sharpe: ${result.performance.sharpeRatio.toFixed(2)}`);
    logger.info('');
  }
  
  // Combined stats
  const totalReturn = results.reduce((sum, r) => sum + r.performance.totalReturnUsd, 0);
  const avgWinRate = results.reduce((sum, r) => sum + r.performance.winRate, 0) / results.length;
  const totalTrades = results.reduce((sum, r) => sum + r.tradeCount, 0);
  
  logger.info('Combined Performance:');
  logger.info(`  Total P&L: $${totalReturn.toFixed(2)}`);
  logger.info(`  Avg Win Rate: ${avgWinRate.toFixed(1)}%`);
  logger.info(`  Total Trades: ${totalTrades}`);
  
  // Save detailed report
  const reportPath = path.join(CONFIG.dataDir, `backtest-report-${Date.now()}.json`);
  await fs.writeFile(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    config: CONFIG,
    results
  }, null, 2));
  
  logger.info(`\nDetailed report saved: ${reportPath}`);
}

/**
 * Main function
 */
async function main() {
  logger.info('=== Backtest Runner ===');
  logger.info(`Data directory: ${CONFIG.dataDir}`);
  logger.info(`Initial balance: $${CONFIG.initialBalance}`);
  
  // Check if data exists
  try {
    await fs.access(CONFIG.dataDir);
  } catch {
    logger.error(`Data directory not found: ${CONFIG.dataDir}`);
    logger.info('Run: node scripts/download-backtest-data.js');
    process.exit(1);
  }
  
  const results = [];
  
  // Run backtests for each pair
  for (const pair of CONFIG.pairs) {
    // Load all timeframes
    const timeframeData = {};
    for (const tf of CONFIG.timeframes) {
      timeframeData[tf] = await loadCandles(pair, tf);
    }
    
    // Use date range or last N days for testing
    const primaryCandles = timeframeData[CONFIG.timeframes[0]];
    if (!primaryCandles) continue;
    
    let testCandles;
    if (CONFIG.testStartDate && CONFIG.testEndDate) {
      // Filter by exact dates
      const startTime = new Date(CONFIG.testStartDate).getTime();
      const endTime = new Date(CONFIG.testEndDate).getTime();
      testCandles = primaryCandles.filter(c => c.timestamp >= startTime && c.timestamp <= endTime);
      logger.info(`Date filter: ${CONFIG.testStartDate} to ${CONFIG.testEndDate}`);
      logger.info(`Filtered candles: ${testCandles.length}`);
    } else {
      // Use last N days
      const startIndex = Math.max(0, primaryCandles.length - (CONFIG.testStartDays * 24));
      testCandles = primaryCandles.slice(startIndex);
    }
    
    // Also filter higher timeframe candles to align with primary
    for (const tf of CONFIG.timeframes) {
      if (timeframeData[tf] && timeframeData[tf].length > 0) {
        // Find the first candle that matches or is before our test start
        const startTime = testCandles[0]?.timestamp || 0;
        const tfStartIdx = timeframeData[tf].findIndex(c => c.timestamp >= startTime);
        timeframeData[tf] = timeframeData[tf].slice(Math.max(0, tfStartIdx - 100)); // Extra buffer
      }
    }
    
    const result = await runBacktest(pair, testCandles, timeframeData);
    results.push(result);
  }
  
  // Generate report
  await generateReport(results);
  
  logger.info('\n=== Backtest Complete ===');
}

// Run
if (require.main === module) {
  main().catch(error => {
    logger.error('Backtest failed:', error);
    process.exit(1);
  });
}

module.exports = { runBacktest, loadCandles };
