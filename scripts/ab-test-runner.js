#!/usr/bin/env node
/**
 * ab-test-runner.js
 * A/B testing framework for comparing strategy configurations
 * Tests multiple variants and ranks them by performance
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
  testStartDays: 180,
};

// Strategy variants to test - Less aggressive filters
const STRATEGY_VARIANTS = [
  {
    name: 'Base_Momentum_RSI_ADX',
    config: {
      momentum: {
        enabled: true,
        config: {
          primaryTimeframe: '1h',
          emaFast: 9,
          emaSlow: 21,
          minConfidence: 0.65,
          requireRsiFilter: true,
          rsiThreshold: 50,
          requireAdxFilter: true,
          adxThreshold: 15, // Lower threshold
          trailingStopAtrMultiplier: 1.0,
          basePositionSize: 0.10
        }
      },
      meanReversion: { enabled: false }
    }
  },
  {
    name: 'Momentum_RSI_Only',
    config: {
      momentum: {
        enabled: true,
        config: {
          primaryTimeframe: '1h',
          emaFast: 9,
          emaSlow: 21,
          minConfidence: 0.65,
          requireRsiFilter: true,
          rsiThreshold: 50,
          requireAdxFilter: false, // No ADX
          trailingStopAtrMultiplier: 1.0,
          basePositionSize: 0.10
        }
      },
      meanReversion: { enabled: false }
    }
  },
  {
    name: 'Momentum_No_Filters',
    config: {
      momentum: {
        enabled: true,
        config: {
          primaryTimeframe: '1h',
          emaFast: 9,
          emaSlow: 21,
          minConfidence: 0.65,
          requireRsiFilter: false,
          requireAdxFilter: false,
          trailingStopAtrMultiplier: 1.0,
          basePositionSize: 0.10
        }
      },
      meanReversion: { enabled: false }
    }
  },
  {
    name: 'Momentum_EMA12_26',
    config: {
      momentum: {
        enabled: true,
        config: {
          primaryTimeframe: '1h',
          emaFast: 12,
          emaSlow: 26,
          minConfidence: 0.65,
          requireRsiFilter: true,
          rsiThreshold: 45, // More lenient for sells
          requireAdxFilter: true,
          adxThreshold: 15,
          trailingStopAtrMultiplier: 1.0,
          basePositionSize: 0.10
        }
      },
      meanReversion: { enabled: false }
    }
  },
  {
    name: 'MeanReversion_Only',
    config: {
      momentum: { enabled: false },
      meanReversion: {
        enabled: true,
        config: {
          primaryTimeframe: '1h',
          minConfidence: 0.60,
          basePositionSize: 0.10
        }
      }
    }
  }
];

async function loadCandles(pair, timeframe) {
  try {
    const filename = `${pair}_${timeframe}.json`;
    const filepath = path.join(CONFIG.dataDir, filename);
    const data = await fs.readFile(filepath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    logger.error(`Failed to load ${pair} ${timeframe}:`, error.message);
    return null;
  }
}

function detectLongTermTrend(timeframeData, currentTime) {
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

async function runBacktest(pair, candles, timeframeData, strategies, aggregatorConfig) {
  const paperTrading = new PaperTradingEngine({
    initialBalance: CONFIG.initialBalance,
    baseCurrency: 'USDT',
    tradingPairs: [pair.replace('_', '/')],
    maxLossPercent: 3.0
  });
  await paperTrading.initialize();

  const strategiesList = [];
  
  if (strategies.momentum?.enabled) {
    strategiesList.push(new MomentumStrategyV2(strategies.momentum.config));
  }
  if (strategies.meanReversion?.enabled) {
    strategiesList.push(new MeanReversionStrategyV2(strategies.meanReversion.config));
  }

  const aggregator = new SignalAggregator(aggregatorConfig);
  strategiesList.forEach(s => aggregator.registerStrategy(s.name));

  const startIndex = Math.max(0, candles.length - (CONFIG.testStartDays * 24));
  const testCandles = candles.slice(startIndex);

  for (const candle of testCandles) {
    const currentPair = pair.replace('_', '/');
    candle.pair = currentPair;

    const signals = await paperTrading.processCandle(candle, strategiesList);
    
    if (signals && signals.length > 0) {
      const regime = detectLongTermTrend(timeframeData, candle.timestamp);
      const aggregated = aggregator.aggregate(signals, { pair: currentPair, price: candle.close, regime });
      
      if (aggregated.action !== 'hold' && aggregated.confidence >= aggregatorConfig.minCombinedConfidence) {
        try {
          await paperTrading.executeTrade({ ...aggregated, timestamp: candle.timestamp });
        } catch (e) {
          // Trade failed
        }
      }
    }
  }

  const perf = paperTrading.getPerformance();
  return {
    totalReturn: perf.totalReturn,
    winRate: perf.winRate,
    maxDrawdown: perf.maxDrawdown,
    totalTrades: perf.totalTrades,
    finalValue: perf.currentValue
  };
}

async function runVariantTest(variant) {
  logger.info(`\n${'='.repeat(60)}`);
  logger.info(`Testing: ${variant.name}`);
  logger.info(`${'='.repeat(60)}`);
  
  const pair = CONFIG.pairs[0];
  const candles = await loadCandles(pair, '1h');
  if (!candles) return null;

  const timeframeData = {};
  for (const tf of CONFIG.timeframes) {
    timeframeData[tf] = await loadCandles(pair, tf);
    if (timeframeData[tf] && timeframeData[tf].length > 0) {
      const startTime = candles[0]?.timestamp || 0;
      const idx = timeframeData[tf].findIndex(c => c.timestamp >= startTime);
      timeframeData[tf] = timeframeData[tf].slice(Math.max(0, idx - 100));
    }
  }

  const aggregatorConfig = {
    requireConsensus: false,
    minConsensusCount: 1,
    minCombinedConfidence: 0.5
  };

  return runBacktest(pair, candles, timeframeData, variant.config, aggregatorConfig);
}

async function main() {
  logger.info('=== A/B Test Runner ===');
  logger.info(`Testing ${STRATEGY_VARIANTS.length} strategy variants\n`);

  const results = [];

  for (const variant of STRATEGY_VARIANTS) {
    try {
      const perf = await runVariantTest(variant);
      if (perf) {
        results.push({ name: variant.name, ...perf });
      }
    } catch (error) {
      logger.error(`Variant ${variant.name} failed:`, error.message);
    }
  }

  // Sort by total return (descending)
  results.sort((a, b) => b.totalReturn - a.totalReturn);

  logger.info('\n\n=== A/B TEST RESULTS ===\n');
  logger.info('Rank | Variant                    | Return   | Win%  | DD%   | Trades');
  logger.info('-----|---------------------------|----------|-------|-------|-------');

  results.forEach((r, i) => {
    const rank = (i + 1).toString().padStart(4);
    const name = r.name.padEnd(26);
    const ret = (r.totalReturn >= 0 ? '+' : '') + r.totalReturn.toFixed(2) + '%';
    const win = r.winRate.toFixed(1) + '%';
    const dd = r.maxDrawdown.toFixed(2) + '%';
    const trades = r.totalTrades.toString();
    
    logger.info(`${rank} | ${name} | ${ret.padStart(8)} | ${win.padStart(5)} | ${dd.padStart(5)} | ${trades}`);
  });

  logger.info('\n=== WINNER ===');
  const winner = results[0];
  logger.info(`${winner.name}: ${winner.totalReturn.toFixed(2)}% return, ${winner.winRate.toFixed(1)}% win rate, ${winner.maxDrawdown.toFixed(2)}% max DD`);

  // Save results
  const reportFile = path.join(CONFIG.dataDir, `ab-test-report-${Date.now()}.json`);
  await fs.writeFile(reportFile, JSON.stringify(results, null, 2));
  logger.info(`\nReport saved: ${reportFile}`);
}

main().catch(e => {
  logger.error('A/B test failed:', e);
  process.exit(1);
});
