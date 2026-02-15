// vitest globals (describe, it, expect, vi, beforeEach) are injected via vitest.config.js globals: true

// Mock redis before any require
vi.mock('../../src/utils/redis', () => ({
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  keys: vi.fn(() => []),
  connect: vi.fn(),
  disconnect: vi.fn()
}));

// Mock logger to suppress output during tests
vi.mock('../../src/utils/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}));

const Order = require('../../src/models/order');
const OrderValidator = require('../../src/services/orderValidator');
const MetricsCollector = require('../../src/services/metricsCollector');
const eventBus = require('../../src/utils/eventBus');

// ── Shared state ─────────────────────────────────────────────────

let validator;
let collector;

beforeEach(() => {
  validator = new OrderValidator();
  collector = new MetricsCollector({ retentionPeriod: 60000, maxDataPoints: 1000 });
  eventBus.clear();
});

// ═════════════════════════════════════════════════════════════════
// Order Creation Flow (15 tests)
// ═════════════════════════════════════════════════════════════════
describe('Order creation flow', () => {
  it('create a valid market buy order - order object has correct fields', () => {
    const order = new Order({
      userId: 'user-1',
      exchange: 'kraken',
      pair: 'BTC/USD',
      type: 'market',
      side: 'buy',
      amount: 0.5
    });

    expect(order.userId).toBe('user-1');
    expect(order.exchange).toBe('kraken');
    expect(order.pair).toBe('BTC/USD');
    expect(order.type).toBe('market');
    expect(order.side).toBe('buy');
    expect(order.amount).toBe(0.5);
    expect(order.id).toBeDefined();
    expect(order.status).toBe('pending');
  });

  it('create a valid limit buy order with price', () => {
    const order = new Order({
      userId: 'user-1',
      exchange: 'kraken',
      pair: 'BTC/USD',
      type: 'limit',
      side: 'buy',
      amount: 1,
      price: 50000
    });

    expect(order.price).toBe(50000);
    expect(order.type).toBe('limit');

    const result = validator.validate(order);
    expect(result.valid).toBe(true);
  });

  it('create a valid stop order with stopPrice', () => {
    const order = new Order({
      userId: 'user-1',
      exchange: 'kraken',
      pair: 'BTC/USD',
      type: 'stop',
      side: 'sell',
      amount: 0.5,
      stopPrice: 45000
    });

    expect(order.stopPrice).toBe(45000);
    expect(order.type).toBe('stop');
  });

  it('order validation rejects missing fields', () => {
    const result = validator.validate({});
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some(e => e.includes('User ID'))).toBe(true);
    expect(result.errors.some(e => e.includes('Exchange'))).toBe(true);
  });

  it('order validation rejects invalid amount (0, negative, NaN)', () => {
    const baseOrder = {
      userId: 'user-1', exchange: 'kraken', pair: 'BTC/USD',
      type: 'market', side: 'buy'
    };

    const resultZero = validator.validate({ ...baseOrder, amount: 0 });
    expect(resultZero.valid).toBe(false);

    const resultNeg = validator.validate({ ...baseOrder, amount: -1 });
    expect(resultNeg.valid).toBe(false);

    const resultNaN = validator.validate({ ...baseOrder, amount: NaN });
    expect(resultNaN.valid).toBe(false);
  });

  it('order validation rejects invalid price for limit orders', () => {
    const result = validator.validate({
      userId: 'user-1', exchange: 'kraken', pair: 'BTC/USD',
      type: 'limit', side: 'buy', amount: 0.1, price: -100
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Price'))).toBe(true);
  });

  it('order validation rejects invalid pair format', () => {
    const result = validator.validate({
      userId: 'user-1', exchange: 'kraken', pair: 'INVALIDPAIR',
      type: 'market', side: 'buy', amount: 0.1
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('pair'))).toBe(true);
  });

  it('order has unique ID', () => {
    const order1 = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'market', side: 'buy', amount: 1 });
    const order2 = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'market', side: 'buy', amount: 1 });
    expect(order1.id).not.toBe(order2.id);
  });

  it('order starts in pending status', () => {
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'market', side: 'buy', amount: 1 });
    expect(order.status).toBe('pending');
  });

  it('order has correct timestamps', () => {
    const before = new Date();
    const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'market', side: 'buy', amount: 1 });
    const after = new Date();

    expect(order.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(order.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
    expect(order.updatedAt).toBeDefined();
    expect(order.filledAt).toBeNull();
  });

  it('order amount and price are preserved exactly', () => {
    const order = new Order({
      userId: 'u1', exchange: 'kraken', pair: 'BTC/USD',
      type: 'limit', side: 'buy', amount: 0.12345678, price: 50123.45
    });
    expect(order.amount).toBe(0.12345678);
    expect(order.price).toBe(50123.45);
  });

  it('multiple orders for same user get different IDs', () => {
    const ids = new Set();
    for (let i = 0; i < 20; i++) {
      const order = new Order({ userId: 'u1', exchange: 'kraken', pair: 'BTC/USD', type: 'market', side: 'buy', amount: 1 });
      ids.add(order.id);
    }
    expect(ids.size).toBe(20);
  });

  it('order with all optional fields set correctly', () => {
    const order = new Order({
      userId: 'u1', exchange: 'kraken', pair: 'BTC/USD',
      type: 'limit', side: 'buy', amount: 1, price: 50000,
      stopPrice: 49000, timeInForce: 'IOC',
      metadata: { source: 'api' }, strategyId: 'strat-1', notes: 'Test order'
    });

    expect(order.timeInForce).toBe('IOC');
    expect(order.metadata.source).toBe('api');
    expect(order.strategyId).toBe('strat-1');
    expect(order.notes).toBe('Test order');
    expect(order.stopPrice).toBe(49000);
  });

  it('market order without price is valid', () => {
    const order = new Order({
      userId: 'u1', exchange: 'kraken', pair: 'BTC/USD',
      type: 'market', side: 'buy', amount: 0.5
    });
    const result = validator.validate(order);
    expect(result.valid).toBe(true);
    expect(order.price).toBeNull();
  });

  it('limit order without price is invalid', () => {
    const result = validator.validate({
      userId: 'u1', exchange: 'kraken', pair: 'BTC/USD',
      type: 'limit', side: 'buy', amount: 0.5
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Price is required'))).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════
// Order Lifecycle (15 tests)
// ═════════════════════════════════════════════════════════════════
describe('Order lifecycle', () => {
  function createTestOrder(overrides = {}) {
    return new Order({
      userId: 'user-1', exchange: 'kraken', pair: 'BTC/USD',
      type: 'limit', side: 'buy', amount: 1, price: 50000,
      ...overrides
    });
  }

  it('new order -> fill: status changes to filled', () => {
    const order = createTestOrder();
    order.addTrade({ price: 50000, amount: 1, fee: 0.5 });
    expect(order.status).toBe('filled');
  });

  it('new order -> cancel: status changes to cancelled', () => {
    const order = createTestOrder();
    order.updateStatus('cancelled');
    expect(order.status).toBe('cancelled');
    expect(order.cancelledAt).toBeDefined();
    expect(order.cancelledAt).not.toBeNull();
  });

  it('filled order cannot be cancelled (canCancel returns false)', () => {
    const order = createTestOrder();
    order.addTrade({ price: 50000, amount: 1, fee: 0 });
    expect(order.status).toBe('filled');
    expect(order.canCancel()).toBe(false);
  });

  it('cancelled order cannot be filled (isActive returns false)', () => {
    const order = createTestOrder();
    order.updateStatus('cancelled');
    expect(order.isActive()).toBe(false);
  });

  it('partial fill: filledAmount increases, status becomes partial', () => {
    const order = createTestOrder({ amount: 2 });
    order.addTrade({ price: 50000, amount: 0.5, fee: 0.1 });
    expect(order.status).toBe('partial');
    expect(order.filledAmount).toBe(0.5);
    expect(order.remainingAmount).toBe(1.5);
  });

  it('multiple partial fills accumulate', () => {
    const order = createTestOrder({ amount: 3 });
    order.addTrade({ price: 50000, amount: 1, fee: 0.1 });
    order.addTrade({ price: 50100, amount: 1, fee: 0.1 });
    expect(order.filledAmount).toBe(2);
    expect(order.remainingAmount).toBe(1);
    expect(order.status).toBe('partial');
    expect(order.trades).toHaveLength(2);
  });

  it('full fill after partial fills: status becomes filled', () => {
    const order = createTestOrder({ amount: 2 });
    order.addTrade({ price: 50000, amount: 1, fee: 0.1 });
    expect(order.status).toBe('partial');
    order.addTrade({ price: 50100, amount: 1, fee: 0.1 });
    expect(order.status).toBe('filled');
    expect(order.remainingAmount).toBe(0);
  });

  it('order tracks average fill price across partial fills', () => {
    const order = createTestOrder({ amount: 2 });
    order.addTrade({ price: 50000, amount: 1, fee: 0 });
    order.addTrade({ price: 51000, amount: 1, fee: 0 });
    // Average price = (50000*1 + 51000*1) / 2 = 50500
    expect(order.averagePrice).toBe(50500);
  });

  it('fill with fee: fee is recorded', () => {
    const order = createTestOrder();
    order.addTrade({ price: 50000, amount: 1, fee: 12.5 });
    expect(order.fee).toBe(12.5);
  });

  it('cancel returns correct status and sets timestamp', () => {
    const order = createTestOrder();
    const beforeCancel = new Date();
    order.updateStatus('cancelled');
    expect(order.status).toBe('cancelled');
    expect(order.cancelledAt.getTime()).toBeGreaterThanOrEqual(beforeCancel.getTime());
  });

  it('fill updates timestamps', () => {
    const order = createTestOrder();
    const beforeFill = new Date();
    order.addTrade({ price: 50000, amount: 1, fee: 0 });
    expect(order.filledAt).not.toBeNull();
    expect(order.filledAt.getTime()).toBeGreaterThanOrEqual(beforeFill.getTime());
    expect(order.updatedAt.getTime()).toBeGreaterThanOrEqual(beforeFill.getTime());
  });

  it('order value calculations after partial fill', () => {
    const order = createTestOrder({ amount: 2, price: 50000 });
    order.addTrade({ price: 50000, amount: 1, fee: 0 });
    // Total order value = amount * price = 2 * 50000 = 100000
    expect(order.getOrderValue()).toBe(100000);
    // Filled value = filledAmount * averagePrice = 1 * 50000 = 50000
    expect(order.getFilledValue()).toBe(50000);
    // Remaining value = remainingAmount * price = 1 * 50000 = 50000
    expect(order.getRemainingValue()).toBe(50000);
  });

  it('remaining amount after partial fill is correct', () => {
    const order = createTestOrder({ amount: 5 });
    order.addTrade({ price: 50000, amount: 2, fee: 0 });
    expect(order.remainingAmount).toBe(3);
    order.addTrade({ price: 50000, amount: 1.5, fee: 0 });
    expect(order.remainingAmount).toBe(1.5);
  });

  it('cannot fill more than order amount (overfill makes remaining negative)', () => {
    const order = createTestOrder({ amount: 1 });
    order.addTrade({ price: 50000, amount: 1.5, fee: 0 });
    // The Order model doesn't prevent overfill — it just goes to filled status
    // remainingAmount would be negative
    expect(order.remainingAmount).toBeLessThan(0);
    expect(order.status).toBe('filled');
  });

  it('fill with zero amount does not change status to filled', () => {
    const order = createTestOrder({ amount: 1 });
    order.addTrade({ price: 50000, amount: 0, fee: 0 });
    // filledAmount = 0, remainingAmount = 1, so still not filled or partial
    // The addTrade code checks: remainingAmount <= 0 → filled, filledAmount > 0 → partial
    // With 0 fill: filledAmount = 0, remainingAmount = 1 → neither condition met
    expect(order.filledAmount).toBe(0);
    expect(order.status).toBe('pending');
  });
});

// ═════════════════════════════════════════════════════════════════
// Validation Edge Cases (10 tests)
// ═════════════════════════════════════════════════════════════════
describe('Validation edge cases', () => {
  const baseOrder = {
    userId: 'u1', exchange: 'kraken', pair: 'BTC/USD',
    type: 'market', side: 'buy'
  };

  it('amount at exact minimum passes', () => {
    const result = validator.validateAmount(0.0001, 'BTC/USD', 'kraken');
    expect(result.valid).toBe(true);
  });

  it('amount at exact maximum passes', () => {
    const result = validator.validateAmount(1000, 'BTC/USD', 'kraken');
    expect(result.valid).toBe(true);
  });

  it('amount just below minimum fails', () => {
    const result = validator.validateAmount(0.00009, 'BTC/USD', 'kraken');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('at least');
  });

  it('amount just above maximum fails', () => {
    const result = validator.validateAmount(1001, 'BTC/USD', 'kraken');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('exceed');
  });

  it('price precision at limit passes', () => {
    // Default pricePrecision = 8
    const result = validator.validatePrice(50000.12345678, 'BTC/USD', 'kraken');
    expect(result.valid).toBe(true);
  });

  it('price precision over limit fails', () => {
    // Default pricePrecision = 8, so 9 decimals should fail
    const result = validator.validatePrice(50000.123456789, 'BTC/USD', 'kraken');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('precision');
  });

  it('order value at minimum passes', () => {
    // minOrderValue = 10 USD; amount * price = 10
    const result = validator.validateOrderValue(0.0002, 50000, 'kraken');
    // 0.0002 * 50000 = 10
    expect(result.valid).toBe(true);
  });

  it('order value at maximum passes', () => {
    // maxOrderValue = 100000
    const result = validator.validateOrderValue(2, 50000, 'kraken');
    // 2 * 50000 = 100000
    expect(result.valid).toBe(true);
  });

  it('order value below minimum fails', () => {
    // amount * price < 10
    const result = validator.validateOrderValue(0.0001, 50, 'kraken');
    // 0.0001 * 50 = 0.005
    expect(result.valid).toBe(false);
    expect(result.error).toContain('at least');
  });

  it('order value above maximum fails', () => {
    // amount * price > 100000
    const result = validator.validateOrderValue(100, 50000, 'kraken');
    // 100 * 50000 = 5000000
    expect(result.valid).toBe(false);
    expect(result.error).toContain('exceed');
  });
});

// ═════════════════════════════════════════════════════════════════
// Metrics Integration (10 tests)
// ═════════════════════════════════════════════════════════════════
describe('Metrics integration', () => {
  function makeTrade(overrides = {}) {
    return {
      order: {
        id: `o-${Math.random().toString(36).substr(2, 6)}`,
        userId: 'user-1',
        strategyId: 'strat-1',
        pair: 'BTC/USD',
        side: 'buy',
        filledAmount: 1,
        averagePrice: 50000,
        fee: 0.5,
        realizedPnL: 100,
        status: 'filled',
        createdAt: Date.now() - 200,
        filledAt: Date.now(),
        ...overrides
      }
    };
  }

  it('trade record creates correct metric entry', () => {
    collector.recordTrade(makeTrade());

    expect(collector.metrics.trades).toHaveLength(1);
    const metric = collector.metrics.trades[0];
    expect(metric.type).toBe('trade');
    expect(metric.userId).toBe('user-1');
    expect(metric.pair).toBe('BTC/USD');
    expect(metric.side).toBe('buy');
    expect(metric.amount).toBe(1);
    expect(metric.price).toBe(50000);
  });

  it('signal record increments counter', () => {
    collector.recordSignal({
      userId: 'user-1', strategyId: 'strat-1',
      signal: { action: 'buy', pair: 'BTC/USD', price: 50000 }
    });
    expect(collector.counters.signalsGenerated).toBe(1);
    expect(collector.counters.signalsExecuted).toBe(1);
  });

  it('error record includes error details', () => {
    const error = new Error('Connection timeout');
    collector.recordError('network', error, { endpoint: '/api/data' });

    expect(collector.metrics.errors).toHaveLength(1);
    expect(collector.metrics.errors[0].type).toBe('network');
    expect(collector.metrics.errors[0].message).toBe('Connection timeout');
    expect(collector.metrics.errors[0].context.endpoint).toBe('/api/data');
    expect(collector.metrics.errors[0].stack).toBeDefined();
  });

  it('event record goes to events array (not orders - regression test)', () => {
    collector.recordEvent('circuitBreaker', { userId: 'user-1', reason: 'max loss' });

    expect(collector.metrics.events).toHaveLength(1);
    expect(collector.metrics.events[0].type).toBe('circuitBreaker');
    // Regression: events must NOT go to orders
    expect(collector.metrics.orders).toHaveLength(0);
  });

  it('multiple trades accumulate correctly', () => {
    collector.recordTrade(makeTrade({ realizedPnL: 100 }));
    collector.recordTrade(makeTrade({ realizedPnL: -50 }));
    collector.recordTrade(makeTrade({ realizedPnL: 200 }));

    expect(collector.metrics.trades).toHaveLength(3);
    expect(collector.counters.tradesTotal).toBe(3);
    expect(collector.counters.tradesSuccessful).toBe(3); // all status: 'filled'
  });

  it('trade stats calculate correct win rate', () => {
    // 2 winning, 1 losing
    collector.recordTrade(makeTrade({ realizedPnL: 100 }));
    collector.recordTrade(makeTrade({ realizedPnL: 200 }));
    collector.recordTrade(makeTrade({ realizedPnL: -50 }));

    const stats = collector.getTradeStats();
    expect(stats.total).toBe(3);
    expect(stats.winning).toBe(2);
    expect(stats.losing).toBe(1);
    expect(stats.winRate).toBeCloseTo(66.67, 1);
    expect(stats.totalPnl).toBe(250);
  });

  it('trade stats filter by user', () => {
    collector.recordTrade(makeTrade({ userId: 'user-a', realizedPnL: 100 }));
    collector.recordTrade(makeTrade({ userId: 'user-a', realizedPnL: 50 }));
    collector.recordTrade(makeTrade({ userId: 'user-b', realizedPnL: 200 }));

    const statsA = collector.getTradeStats('user-a');
    const statsB = collector.getTradeStats('user-b');

    expect(statsA.total).toBe(2);
    expect(statsA.totalPnl).toBe(150);
    expect(statsB.total).toBe(1);
    expect(statsB.totalPnl).toBe(200);
  });

  it('reset clears all accumulated data', () => {
    collector.recordTrade(makeTrade());
    collector.recordSignal({ userId: 'u1', signal: { action: 'buy' } });
    collector.recordError('test', new Error('err'));
    collector.recordEvent('test', { data: 1 });

    collector.reset();

    expect(collector.metrics.trades).toHaveLength(0);
    expect(collector.metrics.signals).toHaveLength(0);
    expect(collector.metrics.errors).toHaveLength(0);
    expect(collector.metrics.events).toHaveLength(0);
    expect(collector.metrics.latency).toHaveLength(0);
    expect(collector.counters.tradesTotal).toBe(0);
    expect(collector.counters.signalsGenerated).toBe(0);
    expect(collector.counters.errorsTotal).toBe(0);
  });

  it('latency is recorded when order has createdAt and filledAt', () => {
    const createdAt = Date.now() - 500;
    const filledAt = Date.now();
    collector.recordTrade(makeTrade({ createdAt, filledAt }));

    expect(collector.metrics.latency).toHaveLength(1);
    expect(collector.metrics.latency[0].value).toBe(filledAt - createdAt);
    expect(collector.metrics.latency[0].type).toBe('orderExecution');
  });

  it('counter values are independent copies', () => {
    collector.counters.tradesTotal = 10;
    const copy = collector.getCounters();
    copy.tradesTotal = 999;
    // Original should be unaffected
    expect(collector.counters.tradesTotal).toBe(10);
  });
});
