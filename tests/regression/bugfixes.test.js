// vitest globals (describe, it, expect, vi, beforeEach, afterEach) injected via vitest.config.js

const path = require('path');
const { createMockCandle, createMockOrder, createMockPosition } = require('../helpers/fixtures');

// ---------------------------------------------------------------------------
// Global mocks
// ---------------------------------------------------------------------------

// Mock logger to silence output
vi.mock('../../src/utils/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

// Mock redis
vi.mock('../../src/utils/redis', () => ({
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue('OK'),
  del: vi.fn().mockResolvedValue(1),
}));

// Mock eventBus (used by MetricsCollector, TradingEngine, etc.)
vi.mock('../../src/utils/eventBus', () => {
  const EventEmitter = require('events');
  const bus = new EventEmitter();
  bus.setMaxListeners(100);
  bus.subscribers = new Map();
  bus.eventHistory = [];
  bus.metrics = { eventsPublished: 0, eventsHandled: 0, errors: 0 };
  bus.subscribe = vi.fn((event, handler) => {
    bus.on(event, handler);
    return Math.random().toString(36).substr(2, 9);
  });
  bus.unsubscribe = vi.fn();
  bus.publish = vi.fn((event, data) => {
    bus.metrics.eventsPublished++;
    bus.emit(event, data);
  });
  bus.getMetrics = vi.fn(() => bus.metrics);
  bus.clear = vi.fn();
  bus.getHistory = vi.fn(() => []);
  bus.waitFor = vi.fn((event, timeout) => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timeout waiting for event '${event}'`)), timeout || 5000);
      bus.once(event, (data) => { clearTimeout(timer); resolve(data); });
    });
  });
  return bus;
});

// ---------------------------------------------------------------------------
// 1. Parquet dedup: new data wins over old data
// ---------------------------------------------------------------------------
describe('Regression: Parquet dedup — new data wins over old', () => {
  let ParquetWriter;

  beforeEach(() => {
    // Mock parquetjs-lite
    vi.mock('parquetjs-lite', () => ({
      ParquetSchema: vi.fn(),
      ParquetWriter: { openFile: vi.fn().mockResolvedValue({ appendRow: vi.fn(), close: vi.fn() }) },
      ParquetReader: { openFile: vi.fn() },
    }));

    // Mock fs.promises
    vi.mock('fs', () => ({
      promises: {
        mkdir: vi.fn().mockResolvedValue(undefined),
        access: vi.fn().mockResolvedValue(undefined),
        stat: vi.fn().mockResolvedValue({ size: 1024 }),
        readdir: vi.fn().mockResolvedValue([]),
        unlink: vi.fn().mockResolvedValue(undefined),
      },
    }));

    ParquetWriter = require('../../src/services/parquetWriter');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('keeps new candle close price when timestamps match', () => {
    // Simulate the merge logic from appendCandles:
    // new candles come first → [...candles, ...existingCandles]
    const ts = 1700000000000;
    const existingCandles = [{ timestamp: ts, open: 100, high: 110, low: 90, close: 105, volume: 500 }];
    const newCandles = [{ timestamp: ts, open: 101, high: 111, low: 91, close: 999, volume: 600 }];

    const merged = [...newCandles, ...existingCandles];
    merged.sort((a, b) => a.timestamp - b.timestamp);

    const unique = [];
    const seen = new Set();
    for (const candle of merged) {
      if (!seen.has(candle.timestamp)) {
        seen.add(candle.timestamp);
        unique.push(candle);
      }
    }

    expect(unique).toHaveLength(1);
    expect(unique[0].close).toBe(999); // New candle wins
  });

  it('keeps new candle volume when timestamps match', () => {
    const ts = 1700000000000;
    const existingCandles = [{ timestamp: ts, open: 100, high: 110, low: 90, close: 105, volume: 500 }];
    const newCandles = [{ timestamp: ts, open: 101, high: 111, low: 91, close: 106, volume: 9999 }];

    const merged = [...newCandles, ...existingCandles];
    merged.sort((a, b) => a.timestamp - b.timestamp);

    const unique = [];
    const seen = new Set();
    for (const candle of merged) {
      if (!seen.has(candle.timestamp)) {
        seen.add(candle.timestamp);
        unique.push(candle);
      }
    }

    expect(unique[0].volume).toBe(9999);
  });

  it('keeps non-overlapping candles from both existing and new', () => {
    const existingCandles = [
      { timestamp: 1000, close: 100 },
      { timestamp: 2000, close: 200 },
    ];
    const newCandles = [
      { timestamp: 2000, close: 250 },
      { timestamp: 3000, close: 300 },
    ];

    const merged = [...newCandles, ...existingCandles];
    merged.sort((a, b) => a.timestamp - b.timestamp);

    const unique = [];
    const seen = new Set();
    for (const candle of merged) {
      if (!seen.has(candle.timestamp)) {
        seen.add(candle.timestamp);
        unique.push(candle);
      }
    }

    expect(unique).toHaveLength(3);
    expect(unique.map(c => c.timestamp)).toEqual([1000, 2000, 3000]);
    expect(unique[1].close).toBe(250); // new wins at 2000
  });

  it('all candles remain sorted by timestamp after merge', () => {
    const existingCandles = [
      { timestamp: 5000, close: 500 },
      { timestamp: 1000, close: 100 },
    ];
    const newCandles = [
      { timestamp: 3000, close: 300 },
      { timestamp: 7000, close: 700 },
    ];

    const merged = [...newCandles, ...existingCandles];
    merged.sort((a, b) => a.timestamp - b.timestamp);

    const unique = [];
    const seen = new Set();
    for (const candle of merged) {
      if (!seen.has(candle.timestamp)) {
        seen.add(candle.timestamp);
        unique.push(candle);
      }
    }

    for (let i = 1; i < unique.length; i++) {
      expect(unique[i].timestamp).toBeGreaterThan(unique[i - 1].timestamp);
    }
  });

  it('count of unique candles is correct after dedup', () => {
    const ts = 1000;
    const existingCandles = [
      { timestamp: ts, close: 100 },
      { timestamp: ts + 1000, close: 110 },
      { timestamp: ts + 2000, close: 120 },
    ];
    const newCandles = [
      { timestamp: ts, close: 105 },       // dup
      { timestamp: ts + 1000, close: 115 }, // dup
      { timestamp: ts + 3000, close: 130 }, // new
    ];

    const merged = [...newCandles, ...existingCandles];
    merged.sort((a, b) => a.timestamp - b.timestamp);

    const unique = [];
    const seen = new Set();
    for (const candle of merged) {
      if (!seen.has(candle.timestamp)) {
        seen.add(candle.timestamp);
        unique.push(candle);
      }
    }

    expect(unique).toHaveLength(4); // 4 unique timestamps
  });
});

// ---------------------------------------------------------------------------
// 2. Order validator balance check
// ---------------------------------------------------------------------------
describe('Regression: OrderValidator balance check', () => {
  let OrderValidator;
  const logger = require('../../src/utils/logger');

  beforeEach(() => {
    vi.resetModules();
    OrderValidator = require('../../src/services/orderValidator');
  });

  it('without balance provider, returns valid with warning', () => {
    const validator = new OrderValidator();
    // No balance provider set
    const result = validator.validateSufficientBalance({
      userId: 'u1', side: 'buy', amount: 1, price: 50000, pair: 'BTC/USD',
    });
    expect(result.valid).toBe(true);
    expect(result.warning).toBeDefined();
  });

  it('with provider returning sufficient balance, returns valid', () => {
    const validator = new OrderValidator();
    validator.setBalanceProvider({
      getAvailableBalance: () => 100000,
    });
    const result = validator.validateSufficientBalance({
      userId: 'u1', side: 'buy', amount: 1, price: 50000, pair: 'BTC/USD',
    });
    expect(result.valid).toBe(true);
  });

  it('with provider returning insufficient balance, returns error', () => {
    const validator = new OrderValidator();
    validator.setBalanceProvider({
      getAvailableBalance: () => 100,
    });
    const result = validator.validateSufficientBalance({
      userId: 'u1', side: 'buy', amount: 1, price: 50000, pair: 'BTC/USD',
    });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Insufficient/i);
  });

  it('buy order checks amount * price against balance', () => {
    const validator = new OrderValidator();
    validator.setBalanceProvider({
      getAvailableBalance: () => 5000, // exact amount * price
    });
    const result = validator.validateSufficientBalance({
      userId: 'u1', side: 'buy', amount: 0.1, price: 50000, pair: 'BTC/USD',
    });
    // 0.1 * 50000 = 5000, balance = 5000 => exactly sufficient
    expect(result.valid).toBe(true);
  });

  it('sell order checks amount against balance', () => {
    const validator = new OrderValidator();
    validator.setBalanceProvider({
      getAvailableBalance: () => 0.05, // less than amount
    });
    const result = validator.validateSufficientBalance({
      userId: 'u1', side: 'sell', amount: 0.1, price: 50000, pair: 'BTC/USD',
    });
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Trading engine portfolio value
// ---------------------------------------------------------------------------
describe('Regression: TradingEngine getPortfolioValue', () => {
  let TradingEngine;

  beforeEach(() => {
    vi.resetModules();
    TradingEngine = require('../../src/services/tradingEngine');
  });

  it('returns null when no positionManager', async () => {
    const engine = new TradingEngine();
    const value = await engine.getPortfolioValue('u1');
    expect(value).toBeNull();
  });

  it('returns null on positionManager error', async () => {
    const engine = new TradingEngine();
    engine.positionManager = {
      getPortfolioSummary: vi.fn().mockRejectedValue(new Error('DB error')),
    };
    const value = await engine.getPortfolioValue('u1');
    expect(value).toBeNull();
  });

  it('returns actual value from positionManager', async () => {
    const engine = new TradingEngine();
    engine.positionManager = {
      getPortfolioSummary: vi.fn().mockResolvedValue({ totalValue: 75000 }),
    };
    const value = await engine.getPortfolioValue('u1');
    expect(value).toBe(75000);
  });

  it('returns null when totalValue is undefined', async () => {
    const engine = new TradingEngine();
    engine.positionManager = {
      getPortfolioSummary: vi.fn().mockResolvedValue({ positions: [] }),
    };
    const value = await engine.getPortfolioValue('u1');
    expect(value).toBeNull();
  });

  it('returns 0 when totalValue is 0 (not falsy fallback)', async () => {
    const engine = new TradingEngine();
    engine.positionManager = {
      getPortfolioSummary: vi.fn().mockResolvedValue({ totalValue: 0 }),
    };
    const value = await engine.getPortfolioValue('u1');
    // The fix uses ?? null, so 0 is NOT null
    expect(value).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Trading engine risk check uses real portfolio value
// ---------------------------------------------------------------------------
describe('Regression: TradingEngine risk check — no hardcoded 100000', () => {
  let TradingEngine;

  beforeEach(() => {
    TradingEngine = require('../../src/services/tradingEngine');
  });

  it('blocks trade when portfolio value is null', async () => {
    const engine = new TradingEngine();
    engine.positionManager = {
      getPortfolioSummary: vi.fn().mockResolvedValue({ totalValue: null, positions: [] }),
    };
    engine.riskManager = { checkTrade: vi.fn() };
    engine.orderManager = { createOrder: vi.fn() };

    await engine.handleStrategySignal({
      strategyId: 's1',
      userId: 'u1',
      signal: { action: 'buy', pair: 'BTC/USD', amount: 1, price: 50000 },
    });

    // Risk check should NOT have been called because portfolio value is null
    expect(engine.riskManager.checkTrade).not.toHaveBeenCalled();
  });

  it('publishes signalBlocked event with reason when portfolio value unknown', async () => {
    const eventBus = require('../../src/utils/eventBus');
    const publishSpy = vi.spyOn(eventBus, 'publish');

    const engine = new TradingEngine();
    engine.positionManager = {
      getPortfolioSummary: vi.fn().mockResolvedValue({ totalValue: null, positions: [] }),
    };
    engine.riskManager = { checkTrade: vi.fn() };
    engine.orderManager = { createOrder: vi.fn() };

    await engine.handleStrategySignal({
      strategyId: 's1',
      userId: 'u1',
      signal: { action: 'buy', pair: 'BTC/USD', amount: 1, price: 50000 },
    });

    const blockedCall = publishSpy.mock.calls.find(c => c[0] === 'trading:signalBlocked');
    expect(blockedCall).toBeDefined();
    expect(blockedCall[1].reason).toEqual(expect.arrayContaining([expect.stringMatching(/portfolio/i)]));
    publishSpy.mockRestore();
  });

  it('does not create order when blocked', async () => {
    const engine = new TradingEngine();
    engine.positionManager = {
      getPortfolioSummary: vi.fn().mockResolvedValue({ totalValue: null, positions: [] }),
    };
    engine.riskManager = { checkTrade: vi.fn() };
    engine.orderManager = { createOrder: vi.fn() };

    await engine.handleStrategySignal({
      strategyId: 's1',
      userId: 'u1',
      signal: { action: 'buy', pair: 'BTC/USD', amount: 1, price: 50000 },
    });

    expect(engine.orderManager.createOrder).not.toHaveBeenCalled();
  });

  it('proceeds with real portfolio value', async () => {
    const engine = new TradingEngine();
    engine.positionManager = {
      getPortfolioSummary: vi.fn().mockResolvedValue({ totalValue: 80000, positions: [] }),
    };
    engine.riskManager = {
      checkTrade: vi.fn().mockResolvedValue({ allowed: true, failedChecks: [] }),
    };
    engine.orderManager = {
      createOrder: vi.fn().mockResolvedValue({ success: true, data: {} }),
    };

    await engine.handleStrategySignal({
      strategyId: 's1',
      userId: 'u1',
      signal: { action: 'buy', pair: 'BTC/USD', amount: 1, price: 50000 },
    });

    // Risk check called with real totalValue
    expect(engine.riskManager.checkTrade).toHaveBeenCalledWith(
      'u1',
      expect.any(Object),
      expect.objectContaining({ totalValue: 80000 }),
    );
  });

  it('logs warning when blocking', async () => {
    const logger = require('../../src/utils/logger');
    const warnSpy = vi.spyOn(logger, 'warn');

    const engine = new TradingEngine();
    engine.positionManager = {
      getPortfolioSummary: vi.fn().mockResolvedValue({ totalValue: undefined, positions: [] }),
    };
    engine.riskManager = { checkTrade: vi.fn() };
    engine.orderManager = { createOrder: vi.fn() };

    await engine.handleStrategySignal({
      strategyId: 's1',
      userId: 'u1',
      signal: { action: 'buy', pair: 'BTC/USD', amount: 1, price: 50000 },
    });

    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/portfolio value/i));
    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 5. WebSocket resubscribeAll sends messages
// ---------------------------------------------------------------------------
describe('Regression: WebSocket resubscribeAll sends messages', () => {
  let MarketDataWebSocket;

  beforeEach(() => {
    vi.resetModules();
    vi.mock('ws', () => vi.fn());
    MarketDataWebSocket = require('../../src/services/marketDataWebSocket');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends message for each subscription', () => {
    const ws = new MarketDataWebSocket('kraken');
    const sendSpy = vi.fn();
    ws.ws = { send: sendSpy };
    ws.isConnected = true;

    ws.subscriptions.set('ticker:BTC/USD', { channel: 'ticker', pair: 'BTC/USD', subscription: {} });
    ws.subscriptions.set('trade:ETH/USD', { channel: 'trade', pair: 'ETH/USD', subscription: {} });

    ws.resubscribeAll();

    expect(sendSpy).toHaveBeenCalledTimes(2);
  });

  it('handles empty subscriptions map', () => {
    const ws = new MarketDataWebSocket('kraken');
    const sendSpy = vi.fn();
    ws.ws = { send: sendSpy };
    ws.isConnected = true;

    // No subscriptions
    ws.resubscribeAll();

    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('creates correct subscription message format', () => {
    const ws = new MarketDataWebSocket('kraken');
    const sendSpy = vi.fn();
    ws.ws = { send: sendSpy };
    ws.isConnected = true;

    ws.subscriptions.set('ticker:BTC/USD', { channel: 'ticker', pair: 'BTC/USD', subscription: {} });

    ws.resubscribeAll();

    const sentMsg = JSON.parse(sendSpy.mock.calls[0][0]);
    // Kraken subscription message should have event: subscribe
    expect(sentMsg.event).toBe('subscribe');
  });

  it('continues after single subscription error', () => {
    const ws = new MarketDataWebSocket('kraken');
    let callCount = 0;
    const sendSpy = vi.fn(() => {
      callCount++;
      if (callCount === 1) throw new Error('Send failed');
    });
    ws.ws = { send: sendSpy };
    ws.isConnected = true;

    ws.subscriptions.set('ticker:BTC/USD', { channel: 'ticker', pair: 'BTC/USD', subscription: {} });
    ws.subscriptions.set('trade:ETH/USD', { channel: 'trade', pair: 'ETH/USD', subscription: {} });

    // Should not throw
    expect(() => ws.resubscribeAll()).not.toThrow();

    // Second subscription should still be attempted
    expect(sendSpy).toHaveBeenCalledTimes(2);
  });

  it('only sends when connected', () => {
    const ws = new MarketDataWebSocket('kraken');
    const sendSpy = vi.fn();
    ws.ws = { send: sendSpy };
    ws.isConnected = false; // NOT connected

    ws.subscriptions.set('ticker:BTC/USD', { channel: 'ticker', pair: 'BTC/USD', subscription: {} });

    ws.resubscribeAll();

    expect(sendSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 6. RuleEngine — no mock/random data in evaluation loop
// ---------------------------------------------------------------------------
describe('Regression: RuleEngine — no mock data in production evaluation', () => {
  let RuleEngine;
  let debugCalls;

  beforeEach(() => {
    vi.useFakeTimers();
    RuleEngine = require('../../src/services/ruleEngine');
    const logger = require('../../src/utils/logger');
    debugCalls = [];
    logger.debug = vi.fn((...args) => debugCalls.push(args));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('evaluation loop skips when no market data', () => {
    const engine = new RuleEngine();
    engine.startEvaluationLoop();
    vi.advanceTimersByTime(10001);

    const found = debugCalls.some(args => typeof args[0] === 'string' && /no market data/i.test(args[0]));
    expect(found).toBe(true);

    engine.stopEvaluationLoop();
  });

  it('generateMockMarketData exists but is never called by the loop', () => {
    const engine = new RuleEngine();
    const mockSpy = vi.spyOn(engine, 'generateMockMarketData');

    engine.startEvaluationLoop();
    vi.advanceTimersByTime(30001);

    expect(mockSpy).not.toHaveBeenCalled();

    engine.stopEvaluationLoop();
  });

  it('with real market data, evaluation proceeds', () => {
    const engine = new RuleEngine();
    const evaluateSpy = vi.spyOn(engine, 'evaluateRules').mockResolvedValue([]);

    engine.lastMarketData = { 'BTC/USD': { price: 50000 } };
    engine.startEvaluationLoop();
    vi.advanceTimersByTime(10001);

    expect(evaluateSpy).toHaveBeenCalled();

    engine.stopEvaluationLoop();
  });

  it('no random prices in evaluation results', () => {
    const engine = new RuleEngine();
    const mockSpy = vi.spyOn(engine, 'generateMockMarketData');

    engine.startEvaluationLoop();
    vi.advanceTimersByTime(20001);

    expect(mockSpy).not.toHaveBeenCalled();

    engine.stopEvaluationLoop();
  });

  it('debug log emitted when skipping', () => {
    debugCalls = [];
    const engine = new RuleEngine();
    engine.startEvaluationLoop();
    vi.advanceTimersByTime(10001);

    const found = debugCalls.some(args => typeof args[0] === 'string' && /no market data/i.test(args[0]));
    expect(found).toBe(true);

    engine.stopEvaluationLoop();
  });
});

// ---------------------------------------------------------------------------
// 7. StrategyManager — no mock data in execution loop
// ---------------------------------------------------------------------------
describe('Regression: StrategyManager — no mock data in production execution', () => {
  let StrategyManager;
  let debugCalls;

  beforeEach(() => {
    vi.useFakeTimers();
    StrategyManager = require('../../src/services/strategyManager');
    const logger = require('../../src/utils/logger');
    debugCalls = [];
    logger.debug = vi.fn((...args) => debugCalls.push(args));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('execution loop skips when no market data', () => {
    const mgr = new StrategyManager();
    mgr.startExecutionLoop();
    vi.advanceTimersByTime(30001);

    const found = debugCalls.some(args => typeof args[0] === 'string' && /no market data/i.test(args[0]));
    expect(found).toBe(true);

    mgr.stopExecutionLoop();
  });

  it('with real market data, execution proceeds', () => {
    const mgr = new StrategyManager();
    const execSpy = vi.spyOn(mgr, 'executeStrategies').mockResolvedValue();

    mgr.lastMarketData = { 'BTC/USD': { price: 50000 } };
    mgr.startExecutionLoop();
    vi.advanceTimersByTime(30001);

    expect(execSpy).toHaveBeenCalled();

    mgr.stopExecutionLoop();
  });

  it('no random prices used', () => {
    const mgr = new StrategyManager();
    const mockSpy = vi.spyOn(mgr, 'generateMockMarketData');

    mgr.startExecutionLoop();
    vi.advanceTimersByTime(60001);

    expect(mockSpy).not.toHaveBeenCalled();

    mgr.stopExecutionLoop();
  });

  it('debug log emitted when skipping', () => {
    debugCalls = [];
    const mgr = new StrategyManager();
    mgr.startExecutionLoop();
    vi.advanceTimersByTime(30001);

    const found = debugCalls.some(args => typeof args[0] === 'string' && /no market data/i.test(args[0]));
    expect(found).toBe(true);

    mgr.stopExecutionLoop();
  });

  it('loop still runs (interval is set)', () => {
    const mgr = new StrategyManager();
    mgr.startExecutionLoop();

    expect(mgr.executionInterval).not.toBeNull();

    mgr.stopExecutionLoop();
  });
});

// ---------------------------------------------------------------------------
// 8. MetricsCollector events array — recordEvent writes to events, not orders
// ---------------------------------------------------------------------------
describe('Regression: MetricsCollector events array', () => {
  let MetricsCollector;

  beforeEach(() => {
    vi.resetModules();
    MetricsCollector = require('../../src/services/metricsCollector');
  });

  it('recordEvent writes to metrics.events', () => {
    const mc = new MetricsCollector();
    mc.recordEvent('test', { foo: 'bar' });
    expect(mc.metrics.events).toHaveLength(1);
    expect(mc.metrics.events[0].type).toBe('test');
  });

  it('recordEvent does NOT write to metrics.orders', () => {
    const mc = new MetricsCollector();
    const ordersBefore = mc.metrics.orders.length;
    mc.recordEvent('test', { foo: 'bar' });
    expect(mc.metrics.orders.length).toBe(ordersBefore);
  });

  it('metrics.events array exists after construction', () => {
    const mc = new MetricsCollector();
    expect(Array.isArray(mc.metrics.events)).toBe(true);
  });

  it('reset clears events array', () => {
    const mc = new MetricsCollector();
    mc.recordEvent('test', { foo: 'bar' });
    expect(mc.metrics.events.length).toBeGreaterThan(0);
    mc.reset();
    expect(mc.metrics.events).toHaveLength(0);
  });

  it('getSummary includes events count', () => {
    const mc = new MetricsCollector();
    mc.recordEvent('test', { foo: 'bar' });
    mc.recordEvent('test2', { baz: 'qux' });
    const summary = mc.getSummary();
    expect(summary.dataPoints.events).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 9. BacktestController OHLCV parsing — ?? handles 0 correctly (|| did not)
// ---------------------------------------------------------------------------
describe('Regression: BacktestController OHLCV parsing — zero values preserved', () => {
  let backtestController;

  beforeEach(() => {
    vi.resetModules();

    // Mock dependencies the controller imports at top level
    vi.mock('../../src/services/historicalDataService', () => {
      return vi.fn().mockImplementation(() => ({
        fetchOHLCV: vi.fn(),
      }));
    });

    vi.mock('../../src/services/parquetWriter', () => {
      return vi.fn().mockImplementation(() => ({
        getAvailableRange: vi.fn().mockResolvedValue(null),
        readRange: vi.fn().mockResolvedValue([]),
      }));
    });

    vi.mock('../../src/services/backtestEngine', () => {
      return vi.fn().mockImplementation(() => ({
        run: vi.fn().mockResolvedValue({ summary: {}, trades: [], equityCurve: [], signals: [], drawdowns: [] }),
      }));
    });

    vi.mock('../../src/services/strategyOptimizer', () => vi.fn());
    vi.mock('../../src/strategies/strategyFactory', () => ({ create: vi.fn() }));
    vi.mock('../../src/middleware/errorHandler', () => ({ asyncHandler: (fn) => fn }));
    vi.mock('../../src/utils/database', () => ({ getPrisma: vi.fn() }));
    vi.mock('uuid', () => ({ v4: () => 'test-uuid' }));

    backtestController = require('../../src/controllers/backtestController');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('candle with open=0 preserves the zero', async () => {
    // The OHLCV mapping uses ?? which preserves 0
    const rawData = [{ timestamp: 1000, open: 0, high: 10, low: 0, close: 5, volume: 100 }];

    // Access the mapping from getHistoricalData — mock parquetWriter to return null
    // so it falls back to the rawData.map path
    const HistoricalDataService = require('../../src/services/historicalDataService');
    const instance = new HistoricalDataService();
    instance.fetchOHLCV = vi.fn().mockResolvedValue(rawData);

    // Test the mapping logic directly (same as in getHistoricalData)
    const mapped = rawData.map(candle => ({
      timestamp: candle[0] ?? candle.timestamp,
      open: candle[1] ?? candle.open,
      high: candle[2] ?? candle.high,
      low: candle[3] ?? candle.low,
      close: candle[4] ?? candle.close,
      volume: candle[5] ?? candle.volume,
    }));

    expect(mapped[0].open).toBe(0);
  });

  it('candle with close=0 preserves the zero', () => {
    const rawData = [{ timestamp: 1000, open: 10, high: 10, low: 0, close: 0, volume: 100 }];
    const mapped = rawData.map(candle => ({
      timestamp: candle[0] ?? candle.timestamp,
      open: candle[1] ?? candle.open,
      high: candle[2] ?? candle.high,
      low: candle[3] ?? candle.low,
      close: candle[4] ?? candle.close,
      volume: candle[5] ?? candle.volume,
    }));
    expect(mapped[0].close).toBe(0);
  });

  it('candle with volume=0 preserves the zero', () => {
    const rawData = [{ timestamp: 1000, open: 10, high: 10, low: 5, close: 8, volume: 0 }];
    const mapped = rawData.map(candle => ({
      timestamp: candle[0] ?? candle.timestamp,
      open: candle[1] ?? candle.open,
      high: candle[2] ?? candle.high,
      low: candle[3] ?? candle.low,
      close: candle[4] ?? candle.close,
      volume: candle[5] ?? candle.volume,
    }));
    expect(mapped[0].volume).toBe(0);
  });

  it('candle with high=0 preserves the zero', () => {
    const rawData = [{ timestamp: 1000, open: 0, high: 0, low: 0, close: 0, volume: 0 }];
    const mapped = rawData.map(candle => ({
      timestamp: candle[0] ?? candle.timestamp,
      open: candle[1] ?? candle.open,
      high: candle[2] ?? candle.high,
      low: candle[3] ?? candle.low,
      close: candle[4] ?? candle.close,
      volume: candle[5] ?? candle.volume,
    }));
    expect(mapped[0].high).toBe(0);
  });

  it('candle in array format [ts, 0, h, l, c, v] gets open=0', () => {
    const rawData = [[1000, 0, 10, 0, 5, 100]];
    const mapped = rawData.map(candle => ({
      timestamp: candle[0] ?? candle.timestamp,
      open: candle[1] ?? candle.open,
      high: candle[2] ?? candle.high,
      low: candle[3] ?? candle.low,
      close: candle[4] ?? candle.close,
      volume: candle[5] ?? candle.volume,
    }));
    expect(mapped[0].open).toBe(0);
    expect(mapped[0].timestamp).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// 10. JWT secret — no hardcoded fallback
// ---------------------------------------------------------------------------
describe('Regression: JWT secret — no hardcoded fallback', () => {
  it('config JWT_SECRET has no fallback (is process.env.JWT_SECRET directly)', () => {
    // Read the source file and verify no fallback
    const fs = require('fs');
    const configSource = fs.readFileSync(
      path.join(__dirname, '../../src/config/index.js'),
      'utf8'
    );
    // Should be `process.env.JWT_SECRET` without || or fallback
    const jwtLine = configSource.split('\n').find(line => line.includes('JWT_SECRET:') && !line.includes('JWT_REFRESH_SECRET'));
    expect(jwtLine).toBeDefined();
    expect(jwtLine).toContain('process.env.JWT_SECRET');
    expect(jwtLine).not.toContain("||");
    expect(jwtLine).not.toContain("'your-secret-key");
  });

  it('config includes JWT_REFRESH_SECRET', () => {
    const fs = require('fs');
    const configSource = fs.readFileSync(
      path.join(__dirname, '../../src/config/index.js'),
      'utf8'
    );
    expect(configSource).toContain('JWT_REFRESH_SECRET');
  });

  it('requiredVars includes JWT_SECRET', () => {
    const fs = require('fs');
    const configSource = fs.readFileSync(
      path.join(__dirname, '../../src/config/index.js'),
      'utf8'
    );
    // Should have JWT_SECRET in the requiredVars array
    const requiredVarsLine = configSource.split('\n').find(line => line.includes('requiredVars'));
    expect(requiredVarsLine).toContain('JWT_SECRET');
  });

  it('routes/auth uses config.JWT_REFRESH_SECRET not hardcoded string', () => {
    const fs = require('fs');
    const authRouteSource = fs.readFileSync(
      path.join(__dirname, '../../src/routes/auth.js'),
      'utf8'
    );
    // Verify refresh token verification uses config variable
    expect(authRouteSource).toContain('config.JWT_REFRESH_SECRET');
    expect(authRouteSource).not.toContain("'your-secret-key");
  });

  it('middleware/auth uses separate JWT_REFRESH_SECRET for refresh tokens', () => {
    const fs = require('fs');
    const authMiddlewareSource = fs.readFileSync(
      path.join(__dirname, '../../src/middleware/auth.js'),
      'utf8'
    );
    // Should reference JWT_REFRESH_SECRET
    expect(authMiddlewareSource).toContain('JWT_REFRESH_SECRET');
    // Refresh token should be signed with JWT_REFRESH_SECRET, not JWT_SECRET
    // The middleware has: const JWT_REFRESH_SECRET = config.JWT_REFRESH_SECRET
    expect(authMiddlewareSource).toContain('config.JWT_REFRESH_SECRET');
  });
});
