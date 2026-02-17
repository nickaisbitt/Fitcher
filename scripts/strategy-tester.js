#!/usr/bin/env node
/**
 * Strategy tester
 *
 * Runs multiple strategy variants across multiple periods and ranks them by
 * composite score. Designed to be resumable and usable in "fast" mode.
 *
 * Usage:
 *   NODE_ENV=test node scripts/strategy-tester.js
 *   NODE_ENV=test node scripts/strategy-tester.js --periods=bull,recent --limit=8 --pair=BTC_USDT
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
  pair: 'BTC_USDT',
  initialBalance: 100000,
  minCombinedConfidence: 0.5,
  progressFile: path.join(__dirname, '..', 'data', 'historical', 'strategy-test-progress.json'),
};

const ALL_PERIODS = {
  full: { name: 'Full', start: '2019-01-01', end: '2026-02-16' },
  bull: { name: 'Bull', start: '2020-01-01', end: '2021-12-31' },
  bear: { name: 'Bear', start: '2022-01-01', end: '2023-12-31' },
  recent: { name: 'Recent', start: '2025-08-01', end: '2026-02-16' },
};

// Variant matrix (10-15+ requested by user)
const VARIANTS = [
  // EMA family
  { id: 'M1', name: 'Momentum_9_21', group: 'EMA', momentum: { emaFast: 9, emaSlow: 21 } },
  { id: 'M2', name: 'Momentum_12_26', group: 'EMA', momentum: { emaFast: 12, emaSlow: 26 } },
  { id: 'M3', name: 'Momentum_20_50', group: 'EMA', momentum: { emaFast: 20, emaSlow: 50 } },

  // RSI family
  { id: 'M4', name: 'RSI_50', group: 'RSI', momentum: { requireRsiFilter: true, rsiThreshold: 50 } },
  { id: 'M5', name: 'RSI_45', group: 'RSI', momentum: { requireRsiFilter: true, rsiThreshold: 45 } },
  { id: 'M6', name: 'RSI_OFF', group: 'RSI', momentum: { requireRsiFilter: false } },

  // ADX family
  { id: 'M7', name: 'ADX_15', group: 'ADX', momentum: { requireAdxFilter: true, adxThreshold: 15, requireRsiFilter: false, minConfidence: 0.5 } },
  { id: 'M8', name: 'ADX_20', group: 'ADX', momentum: { requireAdxFilter: true, adxThreshold: 20, requireRsiFilter: false, minConfidence: 0.5 } },
  { id: 'M9', name: 'ADX_25', group: 'ADX', momentum: { requireAdxFilter: true, adxThreshold: 25, requireRsiFilter: false, minConfidence: 0.5 } },

  // ADX family (expanded / looser confidence block)
  { id: 'M16', name: 'ADX_LOOSE_1', group: 'ADX2', momentum: { requireAdxFilter: true, adxThreshold: 1, requireRsiFilter: false, minConfidence: 0.38, minTrendAlignment: 0 } },
  { id: 'M17', name: 'ADX_LOOSE_2', group: 'ADX2', momentum: { requireAdxFilter: true, adxThreshold: 2, requireRsiFilter: false, minConfidence: 0.38, minTrendAlignment: 0, emaFast: 7, emaSlow: 21 } },
  { id: 'M18', name: 'ADX_LOOSE_3', group: 'ADX2', momentum: { requireAdxFilter: true, adxThreshold: 3, requireRsiFilter: false, minConfidence: 0.38, minTrendAlignment: 0, emaFast: 7, emaSlow: 21 } },

  // Trail family
  { id: 'M10', name: 'Trail_0.5', group: 'Trail', momentum: { trailingStopAtrMultiplier: 0.5, requireRsiFilter: false, minConfidence: 0.5 } },
  { id: 'M11', name: 'Trail_1.0', group: 'Trail', momentum: { trailingStopAtrMultiplier: 1.0, requireRsiFilter: false, minConfidence: 0.5 } },
  { id: 'M12', name: 'Trail_1.5', group: 'Trail', momentum: { trailingStopAtrMultiplier: 1.5, requireRsiFilter: false, minConfidence: 0.5 } },

  // Position sizing
  { id: 'M13', name: 'Pos_5pct', group: 'Risk', momentum: { basePositionSize: 0.05, requireRsiFilter: false, minConfidence: 0.5 } },
  { id: 'M14', name: 'Pos_10pct', group: 'Risk', momentum: { basePositionSize: 0.10, requireRsiFilter: false, minConfidence: 0.5 } },

  // Mean reversion baseline
  { id: 'M15', name: 'MR_Strict', group: 'MeanRev', type: 'meanReversion', meanReversion: { rsiOversold: 30, rsiOverbought: 70 } },
];

const BASE_MOMENTUM = {
  primaryTimeframe: '1h',
  timeframes: ['15m', '1h'],
  emaFast: 9,
  emaSlow: 21,
  minTrendAlignment: 1,
  minConfidence: 0.6,
  requireRsiFilter: true,
  rsiThreshold: 50,
  requireAdxFilter: false,
  adxThreshold: 20,
  requireVolumeConfirmation: false,
  trailingStopAtrMultiplier: 1.0,
  basePositionSize: 0.1,
};

const BASE_MEANREV = {
  primaryTimeframe: '1h',
  timeframes: ['15m', '1h'],
  requireConfirmation: false,
  minConfidence: 0.6,
  basePositionSize: 0.08,
};

function parseArgs(argv) {
  const out = {
    pair: CONFIG.pair,
    periods: Object.keys(ALL_PERIODS),
    limit: VARIANTS.length,
    variant: null,
    maxCandles: null,
    tailCandles: false,
    resume: false,
  };

  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--pair=')) out.pair = arg.split('=')[1];
    if (arg.startsWith('--periods=')) out.periods = arg.split('=')[1].split(',').filter(Boolean);
    if (arg.startsWith('--limit=')) out.limit = Number(arg.split('=')[1]);
    if (arg.startsWith('--variant=')) out.variant = arg.split('=')[1];
    if (arg.startsWith('--max-candles=')) out.maxCandles = Number(arg.split('=')[1]);
    if (arg === '--tail') out.tailCandles = true;
    if (arg === '--resume') out.resume = true;
  }

  out.periods = out.periods.filter(p => ALL_PERIODS[p]);
  if (out.periods.length === 0) out.periods = ['bull'];
  if (!Number.isFinite(out.limit) || out.limit < 1) out.limit = VARIANTS.length;
  out.limit = Math.min(out.limit, VARIANTS.length);
  if (!Number.isFinite(out.maxCandles) || out.maxCandles <= 0) out.maxCandles = null;
  return out;
}

async function loadCandles(pair, timeframe) {
  const filePath = path.join(CONFIG.dataDir, `${pair}_${timeframe}.json`);
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

function filterCandlesByPeriod(candles, periodKey) {
  const startMs = new Date(ALL_PERIODS[periodKey].start).getTime();
  const endMs = new Date(ALL_PERIODS[periodKey].end).getTime();
  return candles.filter(c => c.timestamp >= startMs && c.timestamp <= endMs);
}

function score(result) {
  return (result.totalReturn * 1.0) + (result.winRate * 0.5) - (result.maxDrawdown * 2.0);
}

function computeRiskProfile(row) {
  const periods = Object.values(row.periods || {});
  if (periods.length === 0) {
    return { level: 'unknown', avgDrawdown: 0, totalTrades: 0 };
  }

  const totalTrades = periods.reduce((sum, p) => sum + (p.trades || 0), 0);
  const avgDrawdown = periods.reduce((sum, p) => sum + (p.maxDrawdown || 0), 0) / periods.length;

  let level = 'low';
  if (avgDrawdown >= 3 || totalTrades >= 30) level = 'high';
  else if (avgDrawdown >= 1 || totalTrades >= 15) level = 'medium';

  return {
    level,
    avgDrawdown,
    totalTrades,
  };
}

function summarizeVariant(row) {
  if (!row) return null;
  const periods = Object.values(row.periods || {});
  const avgReturn = periods.length
    ? periods.reduce((sum, p) => sum + (p.return || 0), 0) / periods.length
    : 0;

  return {
    id: row.id,
    name: row.name,
    group: row.group,
    avgScore: row.avgScore,
    avgReturn,
    riskProfile: computeRiskProfile(row),
    periods: row.periods,
  };
}

function syncStrategyPosition(strategy, trade) {
  if (typeof strategy.recordTrade === 'function') {
    strategy.recordTrade(trade);
    return;
  }

  if (trade.side === 'buy') {
    strategy.position = {
      amount: trade.amount,
      entry: trade.price,
      entryTime: trade.timestamp,
      stopLoss: trade.stopLoss,
      takeProfit: trade.takeProfit,
      trailingStop: trade.trailingStop,
      type: 'long',
    };
    if (typeof strategy.highestPrice === 'number') {
      strategy.highestPrice = trade.price;
    }
  } else {
    strategy.position = null;
    if (typeof strategy.highestPrice === 'number') {
      strategy.highestPrice = 0;
    }
  }
}

function getPositionAmount(paper, pair) {
  const position = paper.positions.get(pair);
  if (!position || typeof position.amount !== 'number') {
    return 0;
  }
  return position.amount;
}

function buildStrategy(variant) {
  if (variant.type === 'meanReversion') {
    return new MeanReversionStrategyV2({ ...BASE_MEANREV, ...variant.meanReversion });
  }
  return new MomentumStrategyV2({ ...BASE_MOMENTUM, ...variant.momentum });
}

async function diagnoseHoldReasons(candles, variant, maxSamples = 3000) {
  const strategy = buildStrategy(variant);
  const reasonCounts = new Map();
  let processed = 0;

  for (const candle of candles) {
    if (processed >= maxSamples) break;
    processed += 1;

    const pair = 'BTC/USDT';
    strategy.update(candle, pair);

    try {
      const signal = await strategy.generateSignal({
        pair,
        price: candle.close,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        volume: candle.volume,
        timestamp: candle.timestamp,
      });

      if (signal && signal.action === 'hold') {
        const reason = signal.reason || 'hold (no reason)';
        reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
      }
    } catch (err) {
      const reason = `error: ${err && err.message ? err.message : String(err)}`;
      reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
    }
  }

  return [...reasonCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([reason, count]) => ({ reason, count }));
}

async function runSingleBacktest(candles, variant) {
  const paper = new PaperTradingEngine({
    initialBalance: CONFIG.initialBalance,
    baseCurrency: 'USDT',
    tradingPairs: ['BTC/USDT'],
    maxLossPercent: 3.0,
    latencyMs: 0,
    latencyVariance: 0,
    suppressExecutionErrors: true,
  });
  await paper.initialize();

  const strategy = buildStrategy(variant);
  const aggregator = new SignalAggregator({
    requireConsensus: false,
    minConsensusCount: 1,
    minCombinedConfidence: CONFIG.minCombinedConfidence,
  });
  aggregator.registerStrategy(strategy.name);

  let nonHoldSignals = 0;
  let executeAttempts = 0;
  let executeFailures = 0;
  let firstFailure = null;

  for (const candle of candles) {
    candle.pair = 'BTC/USDT';
    const signals = await paper.processCandle(candle, [strategy]);
    if (!signals || signals.length === 0) continue;
    nonHoldSignals += signals.length;

    // Neutral regime here to compare strategy logic directly.
    const merged = aggregator.aggregate(signals, {
      pair: candle.pair,
      price: candle.close,
      regime: 'neutral',
    });

    if (merged.action === 'hold' || merged.confidence < CONFIG.minCombinedConfidence) continue;

    const currentPositionAmount = getPositionAmount(paper, candle.pair);
    const isBuy = merged.action === 'buy' || merged.side === 'buy';
    const isSell = merged.action === 'sell' || merged.side === 'sell';

    if ((isBuy && currentPositionAmount > 0) || (isSell && currentPositionAmount <= 0)) {
      continue;
    }

    executeAttempts += 1;
    try {
      const trade = await paper.executeTrade({ ...merged, timestamp: candle.timestamp });
      syncStrategyPosition(strategy, trade);
    } catch (_err) {
      executeFailures += 1;
      if (!firstFailure) firstFailure = _err && _err.message ? _err.message : String(_err);
    }
  }

  const perf = paper.getPerformance();
  return {
    totalReturn: perf.totalReturn,
    winRate: perf.winRate,
    maxDrawdown: perf.maxDrawdown,
    totalTrades: perf.totalTrades,
    currentValue: perf.currentValue,
    _debug: {
      nonHoldSignals,
      executeAttempts,
      executeFailures,
      firstFailure,
    },
  };
}

async function main() {
  const args = parseArgs(process.argv);
  let variants = VARIANTS;
  if (args.variant) {
    variants = VARIANTS.filter(v => v.id === args.variant || v.name === args.variant);
  }
  variants = variants.slice(0, args.limit);

  logger.info(`Strategy tester starting: pair=${args.pair}, periods=${args.periods.join(',')}, variants=${variants.length}`);

  const candles1h = await loadCandles(args.pair, '1h');
  logger.info(`Loaded ${candles1h.length} 1h candles for ${args.pair}`);

  let allResults = [];
  if (args.resume) {
    try {
      const raw = await fs.readFile(CONFIG.progressFile, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.ranking)) {
        allResults = parsed.ranking;
      }
    } catch (_err) {
      // No progress file yet.
    }
  }

  for (const variant of variants) {
    const existing = allResults.find(r => r.id === variant.id);
    const row = existing || { id: variant.id, name: variant.name, group: variant.group, periods: {}, avgScore: 0 };

    const missingPeriods = args.periods.filter(p => !row.periods[p]);
    if (missingPeriods.length === 0) continue;

    logger.info(`Testing ${variant.id} ${variant.name}`);

    for (const periodKey of missingPeriods) {
      let subset = filterCandlesByPeriod(candles1h, periodKey);
      if (args.maxCandles) {
        subset = args.tailCandles ? subset.slice(-args.maxCandles) : subset.slice(0, args.maxCandles);
      }
      if (subset.length < 100) {
        logger.warn(`Skipping ${variant.name} ${periodKey}: insufficient candles (${subset.length})`);
        continue;
      }

      const perf = await runSingleBacktest(subset, variant);
      const s = score(perf);
      let topHoldReasons = [];

      if (perf._debug.nonHoldSignals === 0) {
        topHoldReasons = await diagnoseHoldReasons(subset, variant);
      }

      row.periods[periodKey] = {
        return: perf.totalReturn,
        winRate: perf.winRate,
        maxDrawdown: perf.maxDrawdown,
        trades: perf.totalTrades,
        debug: perf._debug,
        topHoldReasons,
        score: s,
      };

      logger.info(`  ${periodKey}: ret=${perf.totalReturn.toFixed(2)} win=${perf.winRate.toFixed(1)} dd=${perf.maxDrawdown.toFixed(2)} trades=${perf.totalTrades}`);
    }

    const periodScores = Object.values(row.periods).map(p => p.score);
    row.avgScore = periodScores.length ? periodScores.reduce((a, b) => a + b, 0) / periodScores.length : -999;
    if (!existing) allResults.push(row);

    const progressPayload = {
      generatedAt: new Date().toISOString(),
      pair: args.pair,
      periods: args.periods,
      variantsTested: allResults.length,
      ranking: [...allResults].sort((a, b) => b.avgScore - a.avgScore),
    };
    await fs.writeFile(CONFIG.progressFile, JSON.stringify(progressPayload, null, 2));
  }

  allResults.sort((a, b) => b.avgScore - a.avgScore);

  logger.info('--- Final Ranking ---');
  allResults.forEach((r, i) => {
    const p = args.periods[0];
    const pp = r.periods[p];
    const ret = pp ? pp.return.toFixed(2) : '-';
    const win = pp ? pp.winRate.toFixed(1) : '-';
    const dd = pp ? pp.maxDrawdown.toFixed(2) : '-';
    logger.info(`${String(i + 1).padStart(2)}. ${r.name.padEnd(18)} score=${r.avgScore.toFixed(2).padStart(7)} ret=${ret}% win=${win}% dd=${dd}%`);
  });

  const report = {
    generatedAt: new Date().toISOString(),
    pair: args.pair,
    periods: args.periods,
    variantsTested: variants.length,
    winner: allResults[0] || null,
    ranking: allResults,
  };

  const reportTs = Date.now();
  const outPath = path.join(CONFIG.dataDir, `strategy-test-${reportTs}.json`);
  await fs.writeFile(outPath, JSON.stringify(report, null, 2));
  logger.info(`Saved report: ${outPath}`);

  const zeroTradeVariants = allResults
    .filter(row => Object.values(row.periods || {}).every(p => (p.trades || 0) === 0))
    .map(row => ({ id: row.id, name: row.name }));

  const summary = {
    generatedAt: report.generatedAt,
    pair: report.pair,
    periods: report.periods,
    variantsTested: report.variantsTested,
    champion: summarizeVariant(allResults[0]),
    runnerUp: summarizeVariant(allResults[1]),
    top5: allResults.slice(0, 5).map(summarizeVariant),
    zeroTradeVariants,
  };

  const summaryPath = path.join(CONFIG.dataDir, `strategy-test-summary-${reportTs}.json`);
  await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));
  logger.info(`Saved compact summary: ${summaryPath}`);
}

main().catch(err => {
  logger.error(`strategy-tester failed: ${err.message}`);
  process.exit(1);
});
