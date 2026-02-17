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
  timeframes: ['1h'], // Primary timeframe for signals
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
 * Run backtest for a single pair
 */
async function runBacktest(pair, candles) {
  logger.info(`\n=== Backtesting ${pair} ===`);
  logger.info(`Candles: ${candles.length}`);
  logger.info(`Period: ${candles[0].datetime} to ${candles[candles.length - 1].datetime}`);
  
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
      
      // Get regime from strategy state (MomentumV2 tracks this)
      let regime = 'neutral';
      const momentumStrategy = strategies.find(s => s.name.includes('Momentum'));
      if (momentumStrategy) {
        const state = momentumStrategy.indicatorStates.get(currentPair);
        if (state) {
          const snapshot = state.getSnapshot();
          regime = snapshot.trendAlignment?.direction || 'neutral';
        }
      }

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
    const candles = await loadCandles(pair, CONFIG.timeframes[0]);
    if (!candles) continue;
    
    // Use only last N days for initial testing
    const startIndex = Math.max(0, candles.length - (CONFIG.testStartDays * 24));
    const testCandles = candles.slice(startIndex);
    
    const result = await runBacktest(pair, testCandles);
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
