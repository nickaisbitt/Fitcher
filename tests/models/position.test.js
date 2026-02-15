// vitest globals (describe, it, expect, vi) are injected via vitest.config.js globals: true

vi.mock('../../src/utils/logger', () => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

const Position = require('../../src/models/position');

function makePosition(overrides = {}) {
  return new Position({ userId: 'u1', exchange: 'kraken', asset: 'BTC', pair: 'BTC/USD', ...overrides });
}

// ---------- Constructor ----------
describe('Position constructor', () => {
  it('sets userId, exchange, asset, pair', () => {
    const p = makePosition();
    expect(p.userId).toBe('u1');
    expect(p.exchange).toBe('kraken');
    expect(p.asset).toBe('BTC');
    expect(p.pair).toBe('BTC/USD');
  });

  it('defaults totalAmount to 0', () => {
    expect(makePosition().totalAmount).toBe(0);
  });

  it('defaults availableAmount to 0', () => {
    expect(makePosition().availableAmount).toBe(0);
  });

  it('defaults lockedAmount to 0', () => {
    expect(makePosition().lockedAmount).toBe(0);
  });

  it('defaults averageEntryPrice to 0', () => {
    expect(makePosition().averageEntryPrice).toBe(0);
  });

  it('defaults realizedPnL to 0', () => {
    expect(makePosition().realizedPnL).toBe(0);
  });

  it('defaults unrealizedPnL to 0', () => {
    expect(makePosition().unrealizedPnL).toBe(0);
  });

  it('defaults totalFees to 0', () => {
    expect(makePosition().totalFees).toBe(0);
  });

  it('initializes trades as empty array', () => {
    expect(makePosition().trades).toEqual([]);
  });

  it('sets createdAt and updatedAt', () => {
    const p = makePosition();
    expect(p.createdAt).toBeInstanceOf(Date);
    expect(p.updatedAt).toBeInstanceOf(Date);
  });

  it('defaults lastTradeAt to null', () => {
    expect(makePosition().lastTradeAt).toBeNull();
  });
});

// ---------- addBuyTrade ----------
describe('Position.addBuyTrade', () => {
  it('increases totalAmount', () => {
    const p = makePosition();
    p.addBuyTrade({ amount: 1, price: 50000, fee: 10 });
    expect(p.totalAmount).toBe(1);
  });

  it('increases availableAmount', () => {
    const p = makePosition();
    p.addBuyTrade({ amount: 2, price: 50000, fee: 0 });
    expect(p.availableAmount).toBe(2);
  });

  it('computes averageEntryPrice including fee', () => {
    const p = makePosition();
    p.addBuyTrade({ amount: 1, price: 50000, fee: 100 });
    // totalCost = 1*50000 + 100 = 50100, totalAmount = 1
    expect(p.averageEntryPrice).toBe(50100);
  });

  it('computes weighted average across two buys', () => {
    const p = makePosition();
    p.addBuyTrade({ amount: 1, price: 40000, fee: 0 });
    p.addBuyTrade({ amount: 1, price: 60000, fee: 0 });
    expect(p.averageEntryPrice).toBe(50000);
  });

  it('accumulates totalFees', () => {
    const p = makePosition();
    p.addBuyTrade({ amount: 1, price: 50000, fee: 10 });
    p.addBuyTrade({ amount: 1, price: 50000, fee: 20 });
    expect(p.totalFees).toBe(30);
  });

  it('records trade with type buy', () => {
    const p = makePosition();
    p.addBuyTrade({ amount: 1, price: 50000, fee: 0 });
    expect(p.trades).toHaveLength(1);
    expect(p.trades[0].type).toBe('buy');
  });

  it('sets lastTradeAt', () => {
    const p = makePosition();
    p.addBuyTrade({ amount: 1, price: 50000, fee: 0 });
    expect(p.lastTradeAt).toBeInstanceOf(Date);
  });
});

// ---------- addSellTrade ----------
describe('Position.addSellTrade', () => {
  it('decreases totalAmount', () => {
    const p = makePosition();
    p.addBuyTrade({ amount: 2, price: 50000, fee: 0 });
    p.addSellTrade({ amount: 1, price: 55000, fee: 0 });
    expect(p.totalAmount).toBe(1);
  });

  it('calculates positive realizedPnL on profit', () => {
    const p = makePosition();
    p.addBuyTrade({ amount: 1, price: 50000, fee: 0 });
    const pnl = p.addSellTrade({ amount: 1, price: 55000, fee: 0 });
    // proceeds = 1*55000 - 0 = 55000, costBasis = 1*50000 = 50000
    expect(pnl).toBe(5000);
    expect(p.realizedPnL).toBe(5000);
  });

  it('calculates negative realizedPnL on loss', () => {
    const p = makePosition();
    p.addBuyTrade({ amount: 1, price: 50000, fee: 0 });
    const pnl = p.addSellTrade({ amount: 1, price: 45000, fee: 0 });
    expect(pnl).toBe(-5000);
    expect(p.realizedPnL).toBe(-5000);
  });

  it('accounts for sell fee in realizedPnL', () => {
    const p = makePosition();
    p.addBuyTrade({ amount: 1, price: 50000, fee: 0 });
    const pnl = p.addSellTrade({ amount: 1, price: 55000, fee: 100 });
    // proceeds = 55000 - 100 = 54900, costBasis = 50000
    expect(pnl).toBe(4900);
  });

  it('handles partial sell', () => {
    const p = makePosition();
    p.addBuyTrade({ amount: 2, price: 50000, fee: 0 });
    p.addSellTrade({ amount: 1, price: 55000, fee: 0 });
    expect(p.totalAmount).toBe(1);
    expect(p.availableAmount).toBe(1);
  });

  it('records trade with type sell', () => {
    const p = makePosition();
    p.addBuyTrade({ amount: 1, price: 50000, fee: 0 });
    p.addSellTrade({ amount: 1, price: 55000, fee: 0 });
    expect(p.trades[1].type).toBe('sell');
    expect(p.trades[1].realizedPnL).toBe(5000);
  });

  it('accumulates realized PnL across sells', () => {
    const p = makePosition();
    p.addBuyTrade({ amount: 3, price: 50000, fee: 0 });
    p.addSellTrade({ amount: 1, price: 55000, fee: 0 });
    p.addSellTrade({ amount: 1, price: 52000, fee: 0 });
    // First sell: 55000 - 50000 = 5000
    // Second sell: 52000 - 50000 = 2000
    expect(p.realizedPnL).toBe(7000);
  });
});

// ---------- lockAmount / unlockAmount ----------
describe('Position lock/unlock', () => {
  it('lockAmount reduces available and increases locked', () => {
    const p = makePosition();
    p.addBuyTrade({ amount: 5, price: 100, fee: 0 });
    p.lockAmount(2);
    expect(p.availableAmount).toBe(3);
    expect(p.lockedAmount).toBe(2);
  });

  it('lockAmount throws when insufficient balance', () => {
    const p = makePosition();
    p.addBuyTrade({ amount: 1, price: 100, fee: 0 });
    expect(() => p.lockAmount(2)).toThrow('Insufficient available balance');
  });

  it('unlockAmount restores available from locked', () => {
    const p = makePosition();
    p.addBuyTrade({ amount: 5, price: 100, fee: 0 });
    p.lockAmount(3);
    p.unlockAmount(2);
    expect(p.availableAmount).toBe(4);
    expect(p.lockedAmount).toBe(1);
  });

  it('unlockAmount throws when exceeding locked', () => {
    const p = makePosition();
    p.addBuyTrade({ amount: 5, price: 100, fee: 0 });
    p.lockAmount(1);
    expect(() => p.unlockAmount(2)).toThrow('Cannot unlock more than locked amount');
  });
});

// ---------- updateUnrealizedPnL ----------
describe('Position.updateUnrealizedPnL', () => {
  it('calculates positive unrealized PnL', () => {
    const p = makePosition();
    p.addBuyTrade({ amount: 1, price: 50000, fee: 0 });
    p.updateUnrealizedPnL(55000);
    expect(p.unrealizedPnL).toBe(5000);
    expect(p.totalValue).toBe(55000);
  });

  it('calculates negative unrealized PnL', () => {
    const p = makePosition();
    p.addBuyTrade({ amount: 1, price: 50000, fee: 0 });
    p.updateUnrealizedPnL(45000);
    expect(p.unrealizedPnL).toBe(-5000);
  });

  it('sets unrealizedPnL to 0 when flat', () => {
    const p = makePosition();
    p.updateUnrealizedPnL(50000);
    expect(p.unrealizedPnL).toBe(0);
  });

  it('computes totalPnL as realized + unrealized', () => {
    const p = makePosition();
    p.addBuyTrade({ amount: 2, price: 50000, fee: 0 });
    p.addSellTrade({ amount: 1, price: 55000, fee: 0 });
    p.updateUnrealizedPnL(52000);
    // realized = 5000, unrealized = 1*52000 - 50000 = 2000
    expect(p.totalPnL).toBe(7000);
  });
});

// ---------- getSummary ----------
describe('Position.getSummary', () => {
  it('returns all expected keys', () => {
    const p = makePosition();
    p.addBuyTrade({ amount: 1, price: 50000, fee: 10 });
    const summary = p.getSummary(51000);
    expect(summary).toHaveProperty('userId', 'u1');
    expect(summary).toHaveProperty('exchange', 'kraken');
    expect(summary).toHaveProperty('asset', 'BTC');
    expect(summary).toHaveProperty('pair', 'BTC/USD');
    expect(summary).toHaveProperty('totalAmount', 1);
    expect(summary).toHaveProperty('currentPrice', 51000);
    expect(summary).toHaveProperty('tradeCount', 1);
    expect(summary).toHaveProperty('pnlPercent');
  });

  it('updates unrealizedPnL when currentPrice provided', () => {
    const p = makePosition();
    p.addBuyTrade({ amount: 1, price: 50000, fee: 0 });
    const summary = p.getSummary(55000);
    expect(summary.unrealizedPnL).toBe(5000);
  });

  it('does not change unrealizedPnL when no currentPrice', () => {
    const p = makePosition();
    p.addBuyTrade({ amount: 1, price: 50000, fee: 0 });
    const summary = p.getSummary();
    expect(summary.unrealizedPnL).toBe(0);
  });
});

// ---------- isFlat / isLong ----------
describe('Position status helpers', () => {
  it('isFlat returns true when no holdings', () => {
    expect(makePosition().isFlat()).toBe(true);
  });

  it('isFlat returns false after buy', () => {
    const p = makePosition();
    p.addBuyTrade({ amount: 1, price: 100, fee: 0 });
    expect(p.isFlat()).toBe(false);
  });

  it('isLong returns true after buy', () => {
    const p = makePosition();
    p.addBuyTrade({ amount: 1, price: 100, fee: 0 });
    expect(p.isLong()).toBe(true);
  });

  it('isLong returns false when flat', () => {
    expect(makePosition().isLong()).toBe(false);
  });
});

// ---------- getValueAtPrice / getMetrics ----------
describe('Position.getValueAtPrice', () => {
  it('returns totalAmount * price', () => {
    const p = makePosition();
    p.addBuyTrade({ amount: 2, price: 100, fee: 0 });
    expect(p.getValueAtPrice(150)).toBe(300);
  });

  it('returns 0 when flat', () => {
    expect(makePosition().getValueAtPrice(50000)).toBe(0);
  });
});

describe('Position.getMetrics', () => {
  it('returns null when no currentPrice', () => {
    const p = makePosition();
    p.addBuyTrade({ amount: 1, price: 100, fee: 0 });
    expect(p.getMetrics(null)).toBeNull();
  });

  it('returns null when flat', () => {
    expect(makePosition().getMetrics(50000)).toBeNull();
  });

  it('returns correct metrics', () => {
    const p = makePosition();
    p.addBuyTrade({ amount: 1, price: 50000, fee: 0 });
    const m = p.getMetrics(55000);
    expect(m.asset).toBe('BTC');
    expect(m.amount).toBe(1);
    expect(m.currentValue).toBe(55000);
    expect(m.unrealizedPnL).toBe(5000);
    expect(m.unrealizedPnLPercent).toBe(10);
  });
});

// ---------- Edge cases ----------
describe('Position edge cases', () => {
  it('handles zero-fee trades', () => {
    const p = makePosition();
    p.addBuyTrade({ amount: 1, price: 1000, fee: 0 });
    expect(p.totalFees).toBe(0);
    expect(p.averageEntryPrice).toBe(1000);
  });

  it('totalCost never goes below 0 after full sell', () => {
    const p = makePosition();
    p.addBuyTrade({ amount: 1, price: 50000, fee: 0 });
    p.addSellTrade({ amount: 1, price: 55000, fee: 0 });
    expect(p.totalCost).toBe(0);
  });
});
