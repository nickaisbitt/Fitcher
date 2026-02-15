// vitest globals (describe, it, expect, vi) are injected via vitest.config.js globals: true

vi.mock('../../src/utils/logger', () => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

const Order = require('../../src/models/order');
const { createMockOrder } = require('../helpers/fixtures');

// ---------- Constructor ----------
describe('Order constructor', () => {
  it('creates a market order with required fields', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'market', side: 'buy', amount: 1 });
    expect(order.userId).toBe('u1');
    expect(order.exchange).toBe('kraken');
    expect(order.pair).toBe('BTC/USD');
    expect(order.type).toBe('market');
    expect(order.side).toBe('buy');
    expect(order.amount).toBe(1);
  });

  it('creates a limit order with price', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'ETH/USD', type: 'limit', side: 'sell', amount: 2, price: 3000 });
    expect(order.type).toBe('limit');
    expect(order.price).toBe(3000);
  });

  it('creates a stop order with stopPrice', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'stop', side: 'sell', amount: 0.5, stopPrice: 48000 });
    expect(order.type).toBe('stop');
    expect(order.stopPrice).toBe(48000);
  });

  it('creates a stop_limit order with price and stopPrice', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'stop_limit', side: 'buy', amount: 1, price: 52000, stopPrice: 51000 });
    expect(order.type).toBe('stop_limit');
    expect(order.price).toBe(52000);
    expect(order.stopPrice).toBe(51000);
  });

  it('generates a uuid if id is not provided', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'market', side: 'buy', amount: 1 });
    expect(order.id).toBeDefined();
    expect(typeof order.id).toBe('string');
    expect(order.id.length).toBeGreaterThan(0);
  });

  it('uses provided id when given', () => {
    const order = new Order({ id: 'custom-id', userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'market', side: 'buy', amount: 1 });
    expect(order.id).toBe('custom-id');
  });

  it('defaults status to pending', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'market', side: 'buy', amount: 1 });
    expect(order.status).toBe('pending');
  });

  it('defaults timeInForce to GTC', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'limit', side: 'buy', amount: 1, price: 50000 });
    expect(order.timeInForce).toBe('GTC');
  });

  it('accepts custom timeInForce', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'limit', side: 'buy', amount: 1, price: 50000, timeInForce: 'IOC' });
    expect(order.timeInForce).toBe('IOC');
  });

  it('initializes filledAmount to 0 and remainingAmount to amount', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'market', side: 'buy', amount: 5 });
    expect(order.filledAmount).toBe(0);
    expect(order.remainingAmount).toBe(5);
  });

  it('parses amount as float', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'market', side: 'buy', amount: '1.5' });
    expect(order.amount).toBe(1.5);
  });

  it('parses price as float', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'limit', side: 'buy', amount: 1, price: '50000.50' });
    expect(order.price).toBe(50000.50);
  });

  it('sets price to null for market orders without price', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'market', side: 'buy', amount: 1 });
    expect(order.price).toBeNull();
  });

  it('derives feeCurrency from pair', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'ETH/BTC', type: 'market', side: 'buy', amount: 1 });
    expect(order.feeCurrency).toBe('BTC');
  });

  it('defaults feeCurrency to USD when pair is absent', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', type: 'market', side: 'buy', amount: 1 });
    expect(order.feeCurrency).toBe('USD');
  });

  it('initializes metadata from params', () => {
    const meta = { source: 'api' };
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'market', side: 'buy', amount: 1, metadata: meta });
    expect(order.metadata).toEqual(meta);
  });

  it('defaults metadata to empty object', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'market', side: 'buy', amount: 1 });
    expect(order.metadata).toEqual({});
  });

  it('sets createdAt and updatedAt to Date instances', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'market', side: 'buy', amount: 1 });
    expect(order.createdAt).toBeInstanceOf(Date);
    expect(order.updatedAt).toBeInstanceOf(Date);
  });

  it('initializes trades as empty array', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'market', side: 'buy', amount: 1 });
    expect(order.trades).toEqual([]);
  });
});

// ---------- Status transitions ----------
describe('Order.updateStatus', () => {
  it('transitions from pending to open', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'limit', side: 'buy', amount: 1, price: 50000 });
    order.updateStatus('open');
    expect(order.status).toBe('open');
  });

  it('transitions from open to partial', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'limit', side: 'buy', amount: 1, price: 50000 });
    order.updateStatus('open');
    order.updateStatus('partial', { filledAmount: 0.5, averagePrice: 50000 });
    expect(order.status).toBe('partial');
    expect(order.filledAmount).toBe(0.5);
    expect(order.remainingAmount).toBe(0.5);
  });

  it('transitions from partial to filled', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'limit', side: 'buy', amount: 1, price: 50000 });
    order.updateStatus('partial', { filledAmount: 0.5 });
    order.updateStatus('filled', { filledAmount: 1, averagePrice: 50100 });
    expect(order.status).toBe('filled');
    expect(order.filledAmount).toBe(1);
    expect(order.remainingAmount).toBe(0);
  });

  it('transitions from pending to cancelled', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'limit', side: 'buy', amount: 1, price: 50000 });
    order.updateStatus('cancelled');
    expect(order.status).toBe('cancelled');
    expect(order.cancelledAt).toBeInstanceOf(Date);
  });

  it('throws for invalid status', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'market', side: 'buy', amount: 1 });
    expect(() => order.updateStatus('invalid_status')).toThrow('Invalid order status');
  });

  it('sets filledAt on first fill', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'limit', side: 'buy', amount: 1, price: 50000 });
    expect(order.filledAt).toBeNull();
    order.updateStatus('partial', { filledAmount: 0.3 });
    expect(order.filledAt).toBeInstanceOf(Date);
  });

  it('does not overwrite filledAt on subsequent updates', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'limit', side: 'buy', amount: 1, price: 50000 });
    order.updateStatus('partial', { filledAmount: 0.3 });
    const firstFilledAt = order.filledAt;
    order.updateStatus('filled', { filledAmount: 1 });
    expect(order.filledAt).toBe(firstFilledAt);
  });

  it('updates fee when provided', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'market', side: 'buy', amount: 1 });
    order.updateStatus('filled', { filledAmount: 1, averagePrice: 50000, fee: 25 });
    expect(order.fee).toBe(25);
  });

  it('updates externalOrderId when provided', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'limit', side: 'buy', amount: 1, price: 50000 });
    order.updateStatus('open', { externalOrderId: 'EXT-123' });
    expect(order.externalOrderId).toBe('EXT-123');
  });

  it('updates updatedAt timestamp', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'market', side: 'buy', amount: 1 });
    const before = order.updatedAt;
    order.updateStatus('open');
    expect(order.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });
});

// ---------- addTrade / fill ----------
describe('Order.addTrade', () => {
  it('adds a single trade and updates filledAmount', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'limit', side: 'buy', amount: 1, price: 50000 });
    order.addTrade({ price: 50000, amount: 0.5, fee: 5 });
    expect(order.trades).toHaveLength(1);
    expect(order.filledAmount).toBe(0.5);
    expect(order.remainingAmount).toBe(0.5);
    expect(order.status).toBe('partial');
  });

  it('fills fully when total trade amount equals order amount', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'limit', side: 'buy', amount: 1, price: 50000 });
    order.addTrade({ price: 50000, amount: 1, fee: 10 });
    expect(order.status).toBe('filled');
    expect(order.remainingAmount).toBe(0);
  });

  it('calculates correct average price from multiple trades', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'limit', side: 'buy', amount: 2, price: 50000 });
    order.addTrade({ price: 49000, amount: 1, fee: 5 });
    order.addTrade({ price: 51000, amount: 1, fee: 5 });
    expect(order.averagePrice).toBe(50000);
    expect(order.status).toBe('filled');
  });

  it('accumulates fees across trades', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'limit', side: 'buy', amount: 2, price: 50000 });
    order.addTrade({ price: 50000, amount: 1, fee: 10 });
    order.addTrade({ price: 50000, amount: 1, fee: 15 });
    expect(order.fee).toBe(25);
  });

  it('assigns tradeId if not provided', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'market', side: 'buy', amount: 1 });
    order.addTrade({ price: 50000, amount: 1, fee: 0 });
    expect(order.trades[0].tradeId).toBeDefined();
  });

  it('uses provided tradeId', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'market', side: 'buy', amount: 1 });
    order.addTrade({ tradeId: 'T-1', price: 50000, amount: 1, fee: 0 });
    expect(order.trades[0].tradeId).toBe('T-1');
  });
});

// ---------- Getter methods ----------
describe('Order getters', () => {
  it('isActive returns true for pending', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'market', side: 'buy', amount: 1 });
    expect(order.isActive()).toBe(true);
  });

  it('isActive returns true for open', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'limit', side: 'buy', amount: 1, price: 50000 });
    order.updateStatus('open');
    expect(order.isActive()).toBe(true);
  });

  it('isActive returns true for partial', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'limit', side: 'buy', amount: 1, price: 50000 });
    order.updateStatus('partial', { filledAmount: 0.5 });
    expect(order.isActive()).toBe(true);
  });

  it('isActive returns false for filled', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'market', side: 'buy', amount: 1 });
    order.updateStatus('filled', { filledAmount: 1, averagePrice: 50000 });
    expect(order.isActive()).toBe(false);
  });

  it('isActive returns false for cancelled', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'market', side: 'buy', amount: 1 });
    order.updateStatus('cancelled');
    expect(order.isActive()).toBe(false);
  });

  it('canCancel returns true for active orders', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'limit', side: 'buy', amount: 1, price: 50000 });
    expect(order.canCancel()).toBe(true);
  });

  it('canCancel returns false for filled orders', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'market', side: 'buy', amount: 1 });
    order.updateStatus('filled', { filledAmount: 1, averagePrice: 50000 });
    expect(order.canCancel()).toBe(false);
  });
});

// ---------- Value calculations ----------
describe('Order value calculations', () => {
  it('getOrderValue returns amount * price for limit order', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'limit', side: 'buy', amount: 2, price: 50000 });
    expect(order.getOrderValue()).toBe(100000);
  });

  it('getOrderValue returns null for market order without price', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'market', side: 'buy', amount: 1 });
    expect(order.getOrderValue()).toBeNull();
  });

  it('getFilledValue returns filledAmount * averagePrice', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'limit', side: 'buy', amount: 2, price: 50000 });
    order.addTrade({ price: 50000, amount: 1, fee: 5 });
    expect(order.getFilledValue()).toBe(50000);
  });

  it('getFilledValue returns 0 when no fills', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'limit', side: 'buy', amount: 1, price: 50000 });
    expect(order.getFilledValue()).toBe(0);
  });

  it('getRemainingValue returns remainingAmount * price', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'limit', side: 'buy', amount: 2, price: 50000 });
    order.addTrade({ price: 50000, amount: 0.5, fee: 0 });
    expect(order.getRemainingValue()).toBe(1.5 * 50000);
  });

  it('getRemainingValue returns null for market orders', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'market', side: 'buy', amount: 1 });
    expect(order.getRemainingValue()).toBeNull();
  });
});

// ---------- getSummary / toJSON ----------
describe('Order.getSummary', () => {
  it('returns all expected fields', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'limit', side: 'buy', amount: 1, price: 50000, strategyId: 's1', notes: 'test' });
    const summary = order.getSummary();
    expect(summary).toHaveProperty('id');
    expect(summary).toHaveProperty('userId', 'u1');
    expect(summary).toHaveProperty('exchange', 'kraken');
    expect(summary).toHaveProperty('pair', 'BTC/USD');
    expect(summary).toHaveProperty('type', 'limit');
    expect(summary).toHaveProperty('side', 'buy');
    expect(summary).toHaveProperty('amount', 1);
    expect(summary).toHaveProperty('price', 50000);
    expect(summary).toHaveProperty('status', 'pending');
    expect(summary).toHaveProperty('orderValue', 50000);
    expect(summary).toHaveProperty('tradeCount', 0);
    expect(summary).toHaveProperty('strategyId', 's1');
    expect(summary).toHaveProperty('notes', 'test');
  });
});

describe('Order.toJSON', () => {
  it('returns all fields needed for serialization', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'limit', side: 'buy', amount: 1, price: 50000 });
    const json = order.toJSON();
    expect(json).toHaveProperty('id');
    expect(json).toHaveProperty('trades');
    expect(json).toHaveProperty('metadata');
    expect(json).toHaveProperty('cancelledAt');
  });
});

describe('Order.fromJSON', () => {
  it('round-trips through toJSON and fromJSON', () => {
    const original = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'limit', side: 'buy', amount: 2, price: 50000, strategyId: 's1', notes: 'note' });
    original.addTrade({ price: 50000, amount: 1, fee: 5 });
    const json = original.toJSON();
    const restored = Order.fromJSON(json);

    expect(restored.id).toBe(original.id);
    expect(restored.status).toBe(original.status);
    expect(restored.filledAmount).toBe(original.filledAmount);
    expect(restored.remainingAmount).toBe(original.remainingAmount);
    expect(restored.averagePrice).toBe(original.averagePrice);
    expect(restored.fee).toBe(original.fee);
    expect(restored.trades).toHaveLength(1);
  });

  it('restores timestamps as Date instances', () => {
    const original = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'market', side: 'buy', amount: 1 });
    original.updateStatus('filled', { filledAmount: 1, averagePrice: 50000 });
    const restored = Order.fromJSON(original.toJSON());
    expect(restored.createdAt).toBeInstanceOf(Date);
    expect(restored.updatedAt).toBeInstanceOf(Date);
    expect(restored.filledAt).toBeInstanceOf(Date);
  });
});

// ---------- Edge cases ----------
describe('Order edge cases', () => {
  it('handles zero amount', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'market', side: 'buy', amount: 0 });
    expect(order.amount).toBe(0);
    expect(order.remainingAmount).toBe(0);
  });

  it('handles very large amounts', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'limit', side: 'buy', amount: 1_000_000, price: 100_000 });
    expect(order.getOrderValue()).toBe(100_000_000_000);
  });

  it('handles very small amounts (precision)', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'limit', side: 'buy', amount: 0.00000001, price: 50000 });
    expect(order.amount).toBe(0.00000001);
  });

  it('sets strategyId when provided', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'market', side: 'buy', amount: 1, strategyId: 'strat-42' });
    expect(order.strategyId).toBe('strat-42');
  });

  it('defaults strategyId to null', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'market', side: 'buy', amount: 1 });
    expect(order.strategyId).toBeNull();
  });
});
