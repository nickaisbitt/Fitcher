// vitest globals (describe, it, expect, vi) are injected via vitest.config.js globals: true

vi.mock('../../src/utils/logger', () => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

const TradingStrategy = require('../../src/models/tradingStrategy');
const { createMockStrategyConfig } = require('../helpers/fixtures');

function makeStrategy(overrides = {}) {
  return new TradingStrategy(createMockStrategyConfig(overrides));
}

// ---------- Constructor ----------
describe('TradingStrategy constructor', () => {
  it('generates an id if not provided', () => {
    const s = makeStrategy();
    expect(s.id).toBeDefined();
    expect(typeof s.id).toBe('string');
  });

  it('uses provided id', () => {
    const s = makeStrategy({ id: 'strat-1' });
    expect(s.id).toBe('strat-1');
  });

  it('sets name and description', () => {
    const s = makeStrategy({ name: 'My Strategy', description: 'desc' });
    expect(s.name).toBe('My Strategy');
    expect(s.description).toBe('desc');
  });

  it('defaults status to inactive', () => {
    expect(makeStrategy().status).toBe('inactive');
  });

  it('accepts all strategy types', () => {
    const types = ['momentum', 'mean_reversion', 'grid', 'dca', 'custom'];
    for (const type of types) {
      expect(makeStrategy({ type }).type).toBe(type);
    }
  });

  it('stores parameters', () => {
    const s = makeStrategy({ parameters: { fastEma: 5 } });
    expect(s.parameters.fastEma).toBe(5);
  });

  it('defaults exchange to kraken', () => {
    const s = new TradingStrategy({ userId: 'u1', name: 'S', type: 'dca', pair: 'BTC/USD' });
    expect(s.exchange).toBe('kraken');
  });

  it('defaults side to buy', () => {
    const s = new TradingStrategy({ userId: 'u1', name: 'S', type: 'dca', pair: 'BTC/USD' });
    expect(s.side).toBe('buy');
  });

  it('defaults maxPositionSize to 0.1', () => {
    const s = new TradingStrategy({ userId: 'u1', name: 'S', type: 'dca', pair: 'BTC/USD' });
    expect(s.maxPositionSize).toBe(0.1);
  });

  it('defaults maxDailyTrades to 10', () => {
    const s = new TradingStrategy({ userId: 'u1', name: 'S', type: 'dca', pair: 'BTC/USD' });
    expect(s.maxDailyTrades).toBe(10);
  });

  it('initializes performance metrics to zero', () => {
    const s = makeStrategy();
    expect(s.performance.totalTrades).toBe(0);
    expect(s.performance.winRate).toBe(0);
    expect(s.performance.totalPnL).toBe(0);
  });

  it('initializes trades and signals as empty', () => {
    const s = makeStrategy();
    expect(s.trades).toEqual([]);
    expect(s.signals).toEqual([]);
  });

  it('sets createdAt and updatedAt', () => {
    const s = makeStrategy();
    expect(s.createdAt).toBeInstanceOf(Date);
    expect(s.updatedAt).toBeInstanceOf(Date);
  });

  it('defaults lastRunAt to null', () => {
    expect(makeStrategy().lastRunAt).toBeNull();
  });

  it('defaults error to null', () => {
    expect(makeStrategy().error).toBeNull();
  });
});

// ---------- activate / deactivate / pause / resume ----------
describe('TradingStrategy status transitions', () => {
  it('activate sets status to active', () => {
    const s = makeStrategy();
    const result = s.activate();
    expect(result.success).toBe(true);
    expect(s.status).toBe('active');
  });

  it('activate returns error when already active', () => {
    const s = makeStrategy();
    s.activate();
    const result = s.activate();
    expect(result.success).toBe(false);
    expect(result.error).toContain('already active');
  });

  it('activate clears previous error', () => {
    const s = makeStrategy();
    s.error = 'previous error';
    s.activate();
    expect(s.error).toBeNull();
  });

  it('deactivate sets status to inactive', () => {
    const s = makeStrategy();
    s.activate();
    const result = s.deactivate();
    expect(result.success).toBe(true);
    expect(s.status).toBe('inactive');
  });

  it('pause sets status to paused from active', () => {
    const s = makeStrategy();
    s.activate();
    const result = s.pause();
    expect(result.success).toBe(true);
    expect(s.status).toBe('paused');
  });

  it('pause returns error when not active', () => {
    const s = makeStrategy();
    const result = s.pause();
    expect(result.success).toBe(false);
    expect(result.error).toContain('must be active');
  });

  it('resume sets status to active from paused', () => {
    const s = makeStrategy();
    s.activate();
    s.pause();
    const result = s.resume();
    expect(result.success).toBe(true);
    expect(s.status).toBe('active');
  });

  it('resume returns error when not paused', () => {
    const s = makeStrategy();
    s.activate();
    const result = s.resume();
    expect(result.success).toBe(false);
    expect(result.error).toContain('must be paused');
  });
});

// ---------- updateParameters ----------
describe('TradingStrategy.updateParameters', () => {
  it('merges new parameters with existing ones', () => {
    const s = makeStrategy({ parameters: { a: 1, b: 2 } });
    s.updateParameters({ b: 3, c: 4 });
    expect(s.parameters).toEqual({ a: 1, b: 3, c: 4 });
  });

  it('returns success result', () => {
    const s = makeStrategy();
    const result = s.updateParameters({ x: 1 });
    expect(result.success).toBe(true);
  });

  it('updates updatedAt timestamp', () => {
    const s = makeStrategy();
    const before = s.updatedAt;
    s.updateParameters({ x: 1 });
    expect(s.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });
});

// ---------- recordTrade & performance ----------
describe('TradingStrategy.recordTrade', () => {
  it('adds trade to trades array', () => {
    const s = makeStrategy();
    s.recordTrade({ side: 'buy', price: 50000, amount: 1, realizedPnL: 100, status: 'filled' });
    expect(s.trades).toHaveLength(1);
  });

  it('sets strategyId on recorded trade', () => {
    const s = makeStrategy();
    s.recordTrade({ side: 'buy', price: 50000, amount: 1, status: 'filled' });
    expect(s.trades[0].strategyId).toBe(s.id);
  });

  it('sets timestamp if not provided', () => {
    const s = makeStrategy();
    s.recordTrade({ side: 'buy', price: 50000, amount: 1, status: 'filled' });
    expect(s.trades[0].timestamp).toBeInstanceOf(Date);
  });

  it('uses provided timestamp', () => {
    const ts = new Date('2025-01-01');
    const s = makeStrategy();
    s.recordTrade({ side: 'buy', price: 50000, amount: 1, status: 'filled', timestamp: ts });
    expect(s.trades[0].timestamp).toBe(ts);
  });
});

describe('TradingStrategy performance tracking', () => {
  it('counts totalTrades from filled trades only', () => {
    const s = makeStrategy();
    s.recordTrade({ status: 'filled', realizedPnL: 100 });
    s.recordTrade({ status: 'cancelled', realizedPnL: 0 });
    expect(s.performance.totalTrades).toBe(1);
  });

  it('counts winningTrades correctly', () => {
    const s = makeStrategy();
    s.recordTrade({ status: 'filled', realizedPnL: 100 });
    s.recordTrade({ status: 'filled', realizedPnL: 200 });
    s.recordTrade({ status: 'filled', realizedPnL: -50 });
    expect(s.performance.winningTrades).toBe(2);
  });

  it('counts losingTrades correctly', () => {
    const s = makeStrategy();
    s.recordTrade({ status: 'filled', realizedPnL: 100 });
    s.recordTrade({ status: 'filled', realizedPnL: -50 });
    s.recordTrade({ status: 'filled', realizedPnL: -25 });
    expect(s.performance.losingTrades).toBe(2);
  });

  it('calculates totalPnL', () => {
    const s = makeStrategy();
    s.recordTrade({ status: 'filled', realizedPnL: 100 });
    s.recordTrade({ status: 'filled', realizedPnL: -30 });
    expect(s.performance.totalPnL).toBe(70);
  });

  it('calculates winRate as percentage', () => {
    const s = makeStrategy();
    s.recordTrade({ status: 'filled', realizedPnL: 100 });
    s.recordTrade({ status: 'filled', realizedPnL: -50 });
    expect(s.performance.winRate).toBe(50);
  });

  it('calculates avgWin', () => {
    const s = makeStrategy();
    s.recordTrade({ status: 'filled', realizedPnL: 100 });
    s.recordTrade({ status: 'filled', realizedPnL: 200 });
    expect(s.performance.avgWin).toBe(150);
  });

  it('calculates avgLoss', () => {
    const s = makeStrategy();
    s.recordTrade({ status: 'filled', realizedPnL: -100 });
    s.recordTrade({ status: 'filled', realizedPnL: -200 });
    expect(s.performance.avgLoss).toBe(150);
  });

  it('calculates profitFactor', () => {
    const s = makeStrategy();
    s.recordTrade({ status: 'filled', realizedPnL: 300 });
    s.recordTrade({ status: 'filled', realizedPnL: -100 });
    // profitFactor = totalWin / totalLoss = 300 / 100 = 3
    expect(s.performance.profitFactor).toBe(3);
  });

  it('profitFactor is 0 when no losses', () => {
    const s = makeStrategy();
    s.recordTrade({ status: 'filled', realizedPnL: 100 });
    expect(s.performance.profitFactor).toBe(0);
  });

  it('winRate is 0 when no trades', () => {
    const s = makeStrategy();
    expect(s.performance.winRate).toBe(0);
  });
});

// ---------- validateSignal ----------
describe('TradingStrategy.validateSignal', () => {
  it('accepts hold signal', () => {
    const s = makeStrategy();
    expect(s.validateSignal({ action: 'hold' }).valid).toBe(true);
  });

  it('accepts valid buy signal', () => {
    const s = makeStrategy();
    expect(s.validateSignal({ action: 'buy', price: 50000, amount: 1 }).valid).toBe(true);
  });

  it('rejects invalid action', () => {
    const s = makeStrategy();
    expect(s.validateSignal({ action: 'short' }).valid).toBe(false);
  });

  it('rejects buy signal with no price', () => {
    const s = makeStrategy();
    expect(s.validateSignal({ action: 'buy', amount: 1 }).valid).toBe(false);
  });

  it('rejects sell signal with no amount', () => {
    const s = makeStrategy();
    expect(s.validateSignal({ action: 'sell', price: 50000 }).valid).toBe(false);
  });

  it('rejects signal with zero price', () => {
    const s = makeStrategy();
    expect(s.validateSignal({ action: 'buy', price: 0, amount: 1 }).valid).toBe(false);
  });
});

// ---------- execute ----------
describe('TradingStrategy.execute', () => {
  it('returns error when not active', async () => {
    const s = makeStrategy();
    const result = await s.execute({});
    expect(result.success).toBe(false);
    expect(result.error).toContain('not active');
  });

  it('returns hold from base generateSignal', async () => {
    const s = makeStrategy();
    s.activate();
    const result = await s.execute({});
    expect(result.success).toBe(true);
    expect(result.action).toBe('hold');
  });
});

// ---------- getSummary ----------
describe('TradingStrategy.getSummary', () => {
  it('returns all expected fields', () => {
    const s = makeStrategy();
    const summary = s.getSummary();
    expect(summary).toHaveProperty('id');
    expect(summary).toHaveProperty('userId');
    expect(summary).toHaveProperty('name');
    expect(summary).toHaveProperty('type');
    expect(summary).toHaveProperty('status');
    expect(summary).toHaveProperty('pair');
    expect(summary).toHaveProperty('performance');
    expect(summary).toHaveProperty('tradeCount', 0);
    expect(summary).toHaveProperty('signalCount', 0);
    expect(summary).toHaveProperty('error', null);
  });
});

// ---------- getPerformanceReport ----------
describe('TradingStrategy.getPerformanceReport', () => {
  it('returns strategy summary in report', () => {
    const s = makeStrategy();
    const report = s.getPerformanceReport();
    expect(report).toHaveProperty('strategy');
    expect(report.strategy.id).toBe(s.id);
  });

  it('groups trades by day', () => {
    const s = makeStrategy();
    const today = new Date();
    s.recordTrade({ status: 'filled', realizedPnL: 100, timestamp: today });
    s.recordTrade({ status: 'filled', realizedPnL: 50, timestamp: today });
    const report = s.getPerformanceReport();
    const dayKey = today.toDateString();
    expect(report.dailyPerformance[dayKey].trades).toBe(2);
    expect(report.dailyPerformance[dayKey].pnl).toBe(150);
  });

  it('groups trades by month', () => {
    const s = makeStrategy();
    const date = new Date('2025-06-15');
    s.recordTrade({ status: 'filled', realizedPnL: 200, timestamp: date });
    const report = s.getPerformanceReport();
    expect(report.monthlyPerformance['2025-06']).toBeDefined();
    expect(report.monthlyPerformance['2025-06'].pnl).toBe(200);
  });

  it('includes recent trades (up to 10)', () => {
    const s = makeStrategy();
    for (let i = 0; i < 15; i++) {
      s.recordTrade({ status: 'filled', realizedPnL: i });
    }
    const report = s.getPerformanceReport();
    expect(report.recentTrades).toHaveLength(10);
  });

  it('includes recent signals (up to 10)', () => {
    const s = makeStrategy();
    for (let i = 0; i < 12; i++) {
      s.signals.push({ action: 'hold', timestamp: new Date() });
    }
    const report = s.getPerformanceReport();
    expect(report.recentSignals).toHaveLength(10);
  });
});

// ---------- reset ----------
describe('TradingStrategy.reset', () => {
  it('clears trades, signals, and performance', () => {
    const s = makeStrategy();
    s.recordTrade({ status: 'filled', realizedPnL: 100 });
    s.signals.push({ action: 'buy' });
    s.reset();
    expect(s.trades).toEqual([]);
    expect(s.signals).toEqual([]);
    expect(s.performance.totalTrades).toBe(0);
    expect(s.performance.totalPnL).toBe(0);
  });

  it('returns success', () => {
    const s = makeStrategy();
    expect(s.reset().success).toBe(true);
  });
});
