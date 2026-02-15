// vitest globals (describe, it, expect) are injected via vitest.config.js globals: true
const EventEmitter = require('events');
const TradingEngine = require('../../src/services/tradingEngine');
const eventBus = require('../../src/utils/eventBus');

/** Helper: create a mock component that extends EventEmitter and has vi.fn() stubs */
function mockComponent(methods = []) {
  const comp = new EventEmitter();
  for (const m of methods) {
    comp[m] = vi.fn();
  }
  return comp;
}

describe('TradingEngine', () => {
  let engine;

  beforeEach(() => {
    eventBus.clear();
    engine = new TradingEngine();
  });

  afterEach(() => {
    eventBus.clear();
  });

  // ── constructor ──────────────────────────────────────────────

  describe('constructor', () => {
    it('initializes with null components', () => {
      expect(engine.strategyManager).toBeNull();
      expect(engine.ruleEngine).toBeNull();
      expect(engine.orderManager).toBeNull();
      expect(engine.riskManager).toBeNull();
      expect(engine.positionManager).toBeNull();
      expect(engine.marketDataAggregator).toBeNull();
    });
  });

  // ── initialize ───────────────────────────────────────────────

  describe('initialize', () => {
    it('sets all components from parameter', async () => {
      const sm = mockComponent(['initialize', 'shutdown']);
      const re = mockComponent(['initialize', 'shutdown']);
      const om = mockComponent([]);
      const rm = mockComponent([]);
      const pm = mockComponent([]);
      const mda = {};

      await engine.initialize({
        strategyManager: sm,
        ruleEngine: re,
        orderManager: om,
        riskManager: rm,
        positionManager: pm,
        marketDataAggregator: mda
      });

      expect(engine.strategyManager).toBe(sm);
      expect(engine.ruleEngine).toBe(re);
      expect(engine.orderManager).toBe(om);
      expect(engine.riskManager).toBe(rm);
      expect(engine.positionManager).toBe(pm);
      expect(engine.marketDataAggregator).toBe(mda);
    });

    it('sets up event handlers', async () => {
      const sm = mockComponent(['initialize', 'shutdown']);
      sm.initialize.mockResolvedValue();

      await engine.initialize({
        strategyManager: sm,
        ruleEngine: null,
        orderManager: null,
        riskManager: null,
        positionManager: null,
        marketDataAggregator: null
      });

      // strategyManager should have a 'strategySignal' listener
      expect(sm.listenerCount('strategySignal')).toBeGreaterThan(0);
    });

    it('calls component initialize methods', async () => {
      const sm = mockComponent(['initialize', 'shutdown']);
      const re = mockComponent(['initialize', 'shutdown']);
      sm.initialize.mockResolvedValue();
      re.initialize.mockResolvedValue();

      await engine.initialize({
        strategyManager: sm,
        ruleEngine: re,
        orderManager: null,
        riskManager: null,
        positionManager: null,
        marketDataAggregator: {}
      });

      expect(sm.initialize).toHaveBeenCalledTimes(1);
      expect(re.initialize).toHaveBeenCalledTimes(1);
    });

    it('sets isRunning to true', async () => {
      const sm = mockComponent(['initialize', 'shutdown']);
      sm.initialize.mockResolvedValue();

      await engine.initialize({
        strategyManager: sm,
        ruleEngine: null,
        orderManager: null,
        riskManager: null,
        positionManager: null,
        marketDataAggregator: null
      });

      expect(engine.isRunning).toBe(true);
    });
  });

  // ── handleStrategySignal ─────────────────────────────────────

  describe('handleStrategySignal', () => {
    const signal = {
      userId: 'u1',
      strategyId: 's1',
      signal: { action: 'buy', pair: 'BTC/USD', amount: 0.1, price: 50000 }
    };

    it('publishes trading:strategySignal event', async () => {
      const events = [];
      eventBus.subscribe('trading:strategySignal', (data) => events.push(data));

      engine.orderManager = mockComponent(['createOrder']);
      engine.orderManager.createOrder.mockResolvedValue({ success: true, data: {} });

      await engine.handleStrategySignal(signal);

      expect(events).toHaveLength(1);
      expect(events[0].userId).toBe('u1');
    });

    it('blocks trade when portfolio value is null (bug fix)', async () => {
      engine.riskManager = mockComponent(['checkTrade']);
      engine.positionManager = mockComponent(['getPortfolioSummary']);
      engine.positionManager.getPortfolioSummary.mockResolvedValue({
        totalValue: null, positions: []
      });

      const blocked = [];
      eventBus.subscribe('trading:signalBlocked', (data) => blocked.push(data));

      await engine.handleStrategySignal(signal);

      expect(blocked).toHaveLength(1);
      expect(engine.riskManager.checkTrade).not.toHaveBeenCalled();
    });

    it('blocks trade when risk check fails', async () => {
      engine.riskManager = mockComponent(['checkTrade']);
      engine.positionManager = mockComponent(['getPortfolioSummary']);
      engine.positionManager.getPortfolioSummary.mockResolvedValue({
        totalValue: 100000, positions: []
      });
      engine.riskManager.checkTrade.mockResolvedValue({
        allowed: false, failedChecks: ['max drawdown exceeded']
      });

      const blocked = [];
      eventBus.subscribe('trading:signalBlocked', (data) => blocked.push(data));

      await engine.handleStrategySignal(signal);

      expect(blocked).toHaveLength(1);
    });

    it('creates order when risk check passes', async () => {
      engine.riskManager = mockComponent(['checkTrade']);
      engine.positionManager = mockComponent(['getPortfolioSummary']);
      engine.orderManager = mockComponent(['createOrder']);

      engine.positionManager.getPortfolioSummary.mockResolvedValue({
        totalValue: 100000, positions: []
      });
      engine.riskManager.checkTrade.mockResolvedValue({ allowed: true });
      engine.orderManager.createOrder.mockResolvedValue({
        success: true, data: { id: 'o1' }
      });

      await engine.handleStrategySignal(signal);

      expect(engine.orderManager.createOrder).toHaveBeenCalledTimes(1);
    });

    it('creates order without risk manager', async () => {
      engine.riskManager = null;
      engine.positionManager = null;
      engine.orderManager = mockComponent(['createOrder']);
      engine.orderManager.createOrder.mockResolvedValue({
        success: true, data: { id: 'o1' }
      });

      await engine.handleStrategySignal(signal);

      expect(engine.orderManager.createOrder).toHaveBeenCalledTimes(1);
    });

    it('logs error on failure (does not throw)', async () => {
      engine.riskManager = null;
      engine.orderManager = mockComponent(['createOrder']);
      engine.orderManager.createOrder.mockRejectedValue(new Error('boom'));

      // Should not throw
      await expect(engine.handleStrategySignal(signal)).resolves.toBeUndefined();
    });
  });

  // ── handleRuleTrigger ────────────────────────────────────────

  describe('handleRuleTrigger', () => {
    it('executes place_order action', async () => {
      engine.orderManager = mockComponent(['createOrder']);
      engine.orderManager.createOrder.mockResolvedValue({ success: true });

      await engine.handleRuleTrigger({
        ruleName: 'test', ruleId: 'r1',
        actionResults: [{ type: 'place_order', params: { pair: 'BTC/USD' } }]
      });

      expect(engine.orderManager.createOrder).toHaveBeenCalledTimes(1);
    });

    it('executes send_notification action', async () => {
      const notifications = [];
      eventBus.subscribe('notification:send', (data) => notifications.push(data));

      await engine.handleRuleTrigger({
        ruleName: 'test', ruleId: 'r1',
        actionResults: [{
          type: 'send_notification',
          notification: { message: 'hello' }
        }]
      });

      expect(notifications).toHaveLength(1);
      expect(notifications[0].message).toBe('hello');
    });

    it('handles unknown action type without throwing', async () => {
      await expect(
        engine.handleRuleTrigger({
          ruleName: 'test', ruleId: 'r1',
          actionResults: [{ type: 'unknown_action' }]
        })
      ).resolves.toBeUndefined();
    });
  });

  // ── handleOrderFilled ────────────────────────────────────────

  describe('handleOrderFilled', () => {
    const filledOrder = {
      id: 'o1', userId: 'u1', exchange: 'kraken', pair: 'BTC/USD',
      side: 'buy', filledAmount: 0.5, averagePrice: 50000,
      fee: 1, realizedPnL: 100, strategyId: 's1'
    };

    it('updates position', async () => {
      engine.positionManager = mockComponent(['updatePositionFromTrade', 'getPortfolioSummary']);
      engine.positionManager.getPortfolioSummary.mockResolvedValue({});

      await engine.handleOrderFilled(filledOrder);

      expect(engine.positionManager.updatePositionFromTrade).toHaveBeenCalledTimes(1);
    });

    it('publishes trading:orderFilled event', async () => {
      const events = [];
      eventBus.subscribe('trading:orderFilled', (data) => events.push(data));

      await engine.handleOrderFilled(filledOrder);

      expect(events).toHaveLength(1);
      expect(events[0].order.id).toBe('o1');
      expect(events[0].userId).toBe('u1');
    });

    it('updates strategy performance', async () => {
      const mockStrategy = { recordTrade: vi.fn() };
      engine.strategyManager = mockComponent(['getStrategy', 'persistStrategy']);
      engine.strategyManager.getStrategy.mockResolvedValue(mockStrategy);
      engine.strategyManager.persistStrategy.mockResolvedValue();
      engine.positionManager = mockComponent(['updatePositionFromTrade', 'getPortfolioSummary']);
      engine.positionManager.getPortfolioSummary.mockResolvedValue({});

      await engine.handleOrderFilled(filledOrder);

      expect(mockStrategy.recordTrade).toHaveBeenCalledTimes(1);
      expect(engine.strategyManager.persistStrategy).toHaveBeenCalledTimes(1);
    });
  });

  // ── handleOrderCancelled ─────────────────────────────────────

  describe('handleOrderCancelled', () => {
    it('publishes event', async () => {
      const events = [];
      eventBus.subscribe('trading:orderCancelled', (data) => events.push(data));

      await engine.handleOrderCancelled({ id: 'o1', userId: 'u1' });

      expect(events).toHaveLength(1);
      expect(events[0].order.id).toBe('o1');
    });
  });

  // ── handleCircuitBreaker ─────────────────────────────────────

  describe('handleCircuitBreaker', () => {
    it('deactivates all user strategies', async () => {
      engine.strategyManager = mockComponent([
        'getUserStrategies', 'deactivateStrategy'
      ]);
      engine.strategyManager.getUserStrategies.mockResolvedValue([
        { id: 's1', status: 'active' },
        { id: 's2', status: 'active' }
      ]);
      engine.strategyManager.deactivateStrategy.mockResolvedValue();

      await engine.handleCircuitBreaker({ userId: 'u1' });

      expect(engine.strategyManager.deactivateStrategy).toHaveBeenCalledTimes(2);
    });

    it('cancels all open user orders', async () => {
      engine.orderManager = mockComponent(['getUserOrders', 'cancelOrder']);
      engine.orderManager.getUserOrders.mockResolvedValue([
        { id: 'o1', status: 'open' },
        { id: 'o2', status: 'pending' }
      ]);
      engine.orderManager.cancelOrder.mockResolvedValue();

      await engine.handleCircuitBreaker({ userId: 'u1' });

      expect(engine.orderManager.cancelOrder).toHaveBeenCalledTimes(2);
    });

    it('publishes trading:circuitBreaker event', async () => {
      const events = [];
      eventBus.subscribe('trading:circuitBreaker', (data) => events.push(data));

      await engine.handleCircuitBreaker({ userId: 'u1' });

      expect(events).toHaveLength(1);
      expect(events[0].userId).toBe('u1');
    });
  });

  // ── getPortfolioValue ────────────────────────────────────────

  describe('getPortfolioValue', () => {
    it('returns null when no positionManager (bug fix - NOT 100000)', async () => {
      engine.positionManager = null;
      const value = await engine.getPortfolioValue('u1');
      expect(value).toBeNull();
    });

    it('returns null on error (bug fix - NOT 100000)', async () => {
      engine.positionManager = mockComponent(['getPortfolioSummary']);
      engine.positionManager.getPortfolioSummary.mockRejectedValue(new Error('db error'));

      const value = await engine.getPortfolioValue('u1');
      expect(value).toBeNull();
    });

    it('returns actual value from positionManager', async () => {
      engine.positionManager = mockComponent(['getPortfolioSummary']);
      engine.positionManager.getPortfolioSummary.mockResolvedValue({
        totalValue: 75000
      });

      const value = await engine.getPortfolioValue('u1');
      expect(value).toBe(75000);
    });

    it('returns null when summary has no totalValue (bug fix)', async () => {
      engine.positionManager = mockComponent(['getPortfolioSummary']);
      engine.positionManager.getPortfolioSummary.mockResolvedValue({});

      const value = await engine.getPortfolioValue('u1');
      expect(value).toBeNull();
    });
  });

  // ── getStatus ────────────────────────────────────────────────

  describe('getStatus', () => {
    it('returns component availability', () => {
      engine.strategyManager = {};
      engine.orderManager = {};
      const status = engine.getStatus();

      expect(status.isRunning).toBe(false);
      expect(status.components.strategyManager).toBe(true);
      expect(status.components.orderManager).toBe(true);
      expect(status.components.ruleEngine).toBe(false);
      expect(status.components.riskManager).toBe(false);
    });

    it('includes eventBus metrics', () => {
      const status = engine.getStatus();
      expect(status).toHaveProperty('eventBus');
      expect(status.eventBus).toHaveProperty('eventsPublished');
    });
  });

  // ── shutdown ─────────────────────────────────────────────────

  describe('shutdown', () => {
    it('sets isRunning to false', async () => {
      engine.isRunning = true;
      await engine.shutdown();
      expect(engine.isRunning).toBe(false);
    });

    it('unsubscribes from event bus', async () => {
      // Simulate having subscriptions
      engine.eventSubscriptions = [
        { event: 'market:priceUpdate', id: 'sub-1' }
      ];

      await engine.shutdown();

      expect(engine.eventSubscriptions).toHaveLength(0);
    });

    it('shuts down strategy manager and rule engine', async () => {
      engine.strategyManager = mockComponent(['shutdown']);
      engine.strategyManager.shutdown.mockResolvedValue();
      engine.ruleEngine = mockComponent(['shutdown']);
      engine.ruleEngine.shutdown.mockResolvedValue();

      await engine.shutdown();

      expect(engine.strategyManager.shutdown).toHaveBeenCalledTimes(1);
      expect(engine.ruleEngine.shutdown).toHaveBeenCalledTimes(1);
    });
  });
});
