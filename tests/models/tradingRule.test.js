// vitest globals (describe, it, expect, vi) are injected via vitest.config.js globals: true

vi.mock('../../src/utils/logger', () => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

const TradingRule = require('../../src/models/tradingRule');
const { createMockMarketData } = require('../helpers/fixtures');

function makeRule(overrides = {}) {
  return new TradingRule({
    userId: 'u1',
    name: 'Test Rule',
    exchange: 'kraken',
    pair: 'BTC/USD',
    conditions: [
      { type: 'price_above', params: { pair: 'BTC/USD', threshold: 55000 } }
    ],
    actions: [
      { type: 'send_notification', params: { message: 'Price hit!' } }
    ],
    ...overrides,
  });
}

// ---------- Constructor ----------
describe('TradingRule constructor', () => {
  it('generates an id if not provided', () => {
    const r = makeRule();
    expect(r.id).toBeDefined();
    expect(typeof r.id).toBe('string');
  });

  it('uses provided id', () => {
    const r = makeRule({ id: 'rule-1' });
    expect(r.id).toBe('rule-1');
  });

  it('defaults status to active', () => {
    expect(makeRule().status).toBe('active');
  });

  it('defaults operator to AND', () => {
    expect(makeRule().operator).toBe('AND');
  });

  it('accepts OR operator', () => {
    expect(makeRule({ operator: 'OR' }).operator).toBe('OR');
  });

  it('defaults maxExecutions to 1', () => {
    expect(new TradingRule({ userId: 'u1', name: 'R' }).maxExecutions).toBe(1);
  });

  it('defaults cooldownPeriod to 0', () => {
    expect(makeRule().cooldownPeriod).toBe(0);
  });

  it('defaults expiresAt to null', () => {
    expect(makeRule().expiresAt).toBeNull();
  });

  it('initializes executionCount to 0', () => {
    expect(makeRule().executionCount).toBe(0);
  });

  it('initializes triggerHistory as empty array', () => {
    expect(makeRule().triggerHistory).toEqual([]);
  });
});

// ---------- price_above / price_below ----------
describe('TradingRule price conditions', () => {
  it('price_above met when price exceeds threshold', () => {
    const r = makeRule({ conditions: [{ type: 'price_above', params: { pair: 'BTC/USD', threshold: 45000 } }] });
    const md = createMockMarketData(); // BTC price 50000
    const result = r.evaluate(md, {}, []);
    expect(result.triggered).toBe(true);
  });

  it('price_above not met when price is below threshold', () => {
    const r = makeRule({ conditions: [{ type: 'price_above', params: { pair: 'BTC/USD', threshold: 55000 } }] });
    const md = createMockMarketData();
    const result = r.evaluate(md, {}, []);
    expect(result.triggered).toBe(false);
  });

  it('price_below met when price is under threshold', () => {
    const r = makeRule({ conditions: [{ type: 'price_below', params: { pair: 'BTC/USD', threshold: 55000 } }] });
    const md = createMockMarketData();
    const result = r.evaluate(md, {}, []);
    expect(result.triggered).toBe(true);
  });

  it('price_below not met when price exceeds threshold', () => {
    const r = makeRule({ conditions: [{ type: 'price_below', params: { pair: 'BTC/USD', threshold: 45000 } }] });
    const md = createMockMarketData();
    const result = r.evaluate(md, {}, []);
    expect(result.triggered).toBe(false);
  });

  it('price condition returns error when pair has no data', () => {
    const r = makeRule({ conditions: [{ type: 'price_above', params: { pair: 'DOGE/USD', threshold: 1 } }] });
    const md = createMockMarketData();
    const result = r.evaluate(md, {}, []);
    expect(result.triggered).toBe(false);
  });
});

// ---------- volume_spike ----------
describe('TradingRule volume_spike condition', () => {
  it('met when volume ratio exceeds multiplier', () => {
    const r = makeRule({
      conditions: [{ type: 'volume_spike', params: { pair: 'BTC/USD', multiplier: 1.0 } }]
    });
    const md = createMockMarketData();
    md.pairs['BTC/USD'].avgVolume = 1000;
    md.pairs['BTC/USD'].volume = 2000;
    const result = r.evaluate(md, {}, []);
    expect(result.triggered).toBe(true);
  });

  it('not met when volume ratio is below multiplier', () => {
    const r = makeRule({
      conditions: [{ type: 'volume_spike', params: { pair: 'BTC/USD', multiplier: 5.0 } }]
    });
    const md = createMockMarketData();
    md.pairs['BTC/USD'].avgVolume = 1500;
    const result = r.evaluate(md, {}, []);
    expect(result.triggered).toBe(false);
  });
});

// ---------- portfolio_value ----------
describe('TradingRule portfolio_value condition', () => {
  it('gt operator met when portfolio exceeds value', () => {
    const r = makeRule({
      conditions: [{ type: 'portfolio_value', params: { operator: 'gt', value: 50000 } }]
    });
    const result = r.evaluate(createMockMarketData(), { totalValue: 100000 }, []);
    expect(result.triggered).toBe(true);
  });

  it('lt operator met when portfolio is below value', () => {
    const r = makeRule({
      conditions: [{ type: 'portfolio_value', params: { operator: 'lt', value: 200000 } }]
    });
    const result = r.evaluate(createMockMarketData(), { totalValue: 100000 }, []);
    expect(result.triggered).toBe(true);
  });

  it('eq operator met on exact match', () => {
    const r = makeRule({
      conditions: [{ type: 'portfolio_value', params: { operator: 'eq', value: 100000 } }]
    });
    const result = r.evaluate(createMockMarketData(), { totalValue: 100000 }, []);
    expect(result.triggered).toBe(true);
  });
});

// ---------- position_size ----------
describe('TradingRule position_size condition', () => {
  it('gt operator met when position amount exceeds threshold', () => {
    const r = makeRule({
      conditions: [{ type: 'position_size', params: { asset: 'BTC', operator: 'gt', value: 0.5 } }]
    });
    const result = r.evaluate(createMockMarketData(), {}, [{ asset: 'BTC', totalAmount: 1 }]);
    expect(result.triggered).toBe(true);
  });

  it('lt operator met when position amount is below threshold', () => {
    const r = makeRule({
      conditions: [{ type: 'position_size', params: { asset: 'BTC', operator: 'lt', value: 2 } }]
    });
    const result = r.evaluate(createMockMarketData(), {}, [{ asset: 'BTC', totalAmount: 1 }]);
    expect(result.triggered).toBe(true);
  });

  it('returns 0 for missing position', () => {
    const r = makeRule({
      conditions: [{ type: 'position_size', params: { asset: 'ETH', operator: 'eq', value: 0 } }]
    });
    const result = r.evaluate(createMockMarketData(), {}, []);
    expect(result.triggered).toBe(true);
  });
});

// ---------- AND / OR logic ----------
describe('TradingRule AND/OR logic', () => {
  it('AND requires all conditions met', () => {
    const r = makeRule({
      operator: 'AND',
      conditions: [
        { type: 'price_above', params: { pair: 'BTC/USD', threshold: 45000 } },
        { type: 'price_below', params: { pair: 'BTC/USD', threshold: 55000 } },
      ],
    });
    const result = r.evaluate(createMockMarketData(), {}, []);
    expect(result.triggered).toBe(true);
  });

  it('AND fails when one condition not met', () => {
    const r = makeRule({
      operator: 'AND',
      conditions: [
        { type: 'price_above', params: { pair: 'BTC/USD', threshold: 45000 } },
        { type: 'price_above', params: { pair: 'BTC/USD', threshold: 55000 } },
      ],
    });
    const result = r.evaluate(createMockMarketData(), {}, []);
    expect(result.triggered).toBe(false);
  });

  it('OR succeeds when at least one condition met', () => {
    const r = makeRule({
      operator: 'OR',
      conditions: [
        { type: 'price_above', params: { pair: 'BTC/USD', threshold: 55000 } },
        { type: 'price_below', params: { pair: 'BTC/USD', threshold: 55000 } },
      ],
    });
    const result = r.evaluate(createMockMarketData(), {}, []);
    expect(result.triggered).toBe(true);
  });

  it('OR fails when no conditions met', () => {
    const r = makeRule({
      operator: 'OR',
      conditions: [
        { type: 'price_above', params: { pair: 'BTC/USD', threshold: 55000 } },
        { type: 'price_above', params: { pair: 'BTC/USD', threshold: 60000 } },
      ],
    });
    const result = r.evaluate(createMockMarketData(), {}, []);
    expect(result.triggered).toBe(false);
  });
});

// ---------- trigger ----------
describe('TradingRule.trigger', () => {
  it('returns triggered: true and executes actions when conditions met', () => {
    const r = makeRule({
      conditions: [{ type: 'price_above', params: { pair: 'BTC/USD', threshold: 45000 } }],
    });
    const result = r.trigger(createMockMarketData(), {}, []);
    expect(result.triggered).toBe(true);
    expect(result.actionResults).toBeDefined();
    expect(result.actionResults.length).toBeGreaterThan(0);
  });

  it('increments executionCount on trigger', () => {
    const r = makeRule({
      maxExecutions: 5,
      conditions: [{ type: 'price_above', params: { pair: 'BTC/USD', threshold: 45000 } }],
    });
    r.trigger(createMockMarketData(), {}, []);
    expect(r.executionCount).toBe(1);
  });

  it('records trigger in triggerHistory', () => {
    const r = makeRule({
      maxExecutions: 5,
      conditions: [{ type: 'price_above', params: { pair: 'BTC/USD', threshold: 45000 } }],
    });
    r.trigger(createMockMarketData(), {}, []);
    expect(r.triggerHistory).toHaveLength(1);
  });

  it('sets lastTriggeredAt', () => {
    const r = makeRule({
      maxExecutions: 5,
      conditions: [{ type: 'price_above', params: { pair: 'BTC/USD', threshold: 45000 } }],
    });
    r.trigger(createMockMarketData(), {}, []);
    expect(r.lastTriggeredAt).toBeDefined();
    expect(typeof r.lastTriggeredAt).toBe('number');
  });

  it('returns triggered: false when conditions not met', () => {
    const r = makeRule({
      conditions: [{ type: 'price_above', params: { pair: 'BTC/USD', threshold: 99000 } }],
    });
    const result = r.trigger(createMockMarketData(), {}, []);
    expect(result.triggered).toBe(false);
  });
});

// ---------- Max executions ----------
describe('TradingRule maxExecutions', () => {
  it('stops triggering after maxExecutions reached', () => {
    const r = makeRule({
      maxExecutions: 1,
      conditions: [{ type: 'price_above', params: { pair: 'BTC/USD', threshold: 45000 } }],
    });
    r.trigger(createMockMarketData(), {}, []);
    const second = r.trigger(createMockMarketData(), {}, []);
    expect(second.triggered).toBe(false);
    expect(r.status).toBe('triggered');
  });

  it('sets status to triggered when max reached', () => {
    const r = makeRule({
      maxExecutions: 2,
      conditions: [{ type: 'price_above', params: { pair: 'BTC/USD', threshold: 45000 } }],
    });
    r.trigger(createMockMarketData(), {}, []);
    r.trigger(createMockMarketData(), {}, []);
    expect(r.status).toBe('triggered');
  });
});

// ---------- Cooldown ----------
describe('TradingRule cooldown', () => {
  it('blocks trigger during cooldown period', () => {
    const r = makeRule({
      maxExecutions: 10,
      cooldownPeriod: 60000,
      conditions: [{ type: 'price_above', params: { pair: 'BTC/USD', threshold: 45000 } }],
    });
    r.trigger(createMockMarketData(), {}, []);
    const result = r.trigger(createMockMarketData(), {}, []);
    expect(result.triggered).toBe(false);
    expect(result.reason).toContain('Cooldown active');
  });
});

// ---------- Expiration ----------
describe('TradingRule expiration', () => {
  it('returns not triggered when rule has expired', () => {
    const r = makeRule({
      expiresAt: new Date(Date.now() - 10000).toISOString(),
      conditions: [{ type: 'price_above', params: { pair: 'BTC/USD', threshold: 45000 } }],
    });
    const result = r.evaluate(createMockMarketData(), {}, []);
    expect(result.triggered).toBe(false);
    expect(result.reason).toBe('Rule expired');
    expect(r.status).toBe('expired');
  });
});

// ---------- pause / resume / reset ----------
describe('TradingRule pause/resume/reset', () => {
  it('pause sets status to paused', () => {
    const r = makeRule();
    r.pause();
    expect(r.status).toBe('paused');
  });

  it('paused rule does not evaluate', () => {
    const r = makeRule({
      conditions: [{ type: 'price_above', params: { pair: 'BTC/USD', threshold: 45000 } }],
    });
    r.pause();
    const result = r.evaluate(createMockMarketData(), {}, []);
    expect(result.triggered).toBe(false);
    expect(result.reason).toContain('paused');
  });

  it('resume sets status to active', () => {
    const r = makeRule();
    r.pause();
    r.resume();
    expect(r.status).toBe('active');
  });

  it('reset clears executionCount and triggerHistory', () => {
    const r = makeRule({
      maxExecutions: 5,
      conditions: [{ type: 'price_above', params: { pair: 'BTC/USD', threshold: 45000 } }],
    });
    r.trigger(createMockMarketData(), {}, []);
    r.reset();
    expect(r.executionCount).toBe(0);
    expect(r.triggerHistory).toEqual([]);
    expect(r.lastTriggeredAt).toBeNull();
    expect(r.status).toBe('active');
  });
});

// ---------- Actions ----------
describe('TradingRule actions', () => {
  it('place_order action returns order params', () => {
    const r = makeRule({
      actions: [{ type: 'place_order', params: { side: 'buy', amount: 0.1, orderType: 'market' } }],
      conditions: [{ type: 'price_above', params: { pair: 'BTC/USD', threshold: 45000 } }],
      maxExecutions: 5,
    });
    const result = r.trigger(createMockMarketData(), {}, []);
    expect(result.actionResults[0].success).toBe(true);
    expect(result.actionResults[0].type).toBe('place_order');
    expect(result.actionResults[0].params.side).toBe('buy');
  });

  it('send_notification action returns notification object', () => {
    const r = makeRule({
      actions: [{ type: 'send_notification', params: { message: 'Alert!' } }],
      conditions: [{ type: 'price_above', params: { pair: 'BTC/USD', threshold: 45000 } }],
      maxExecutions: 5,
    });
    const result = r.trigger(createMockMarketData(), {}, []);
    expect(result.actionResults[0].success).toBe(true);
    expect(result.actionResults[0].type).toBe('send_notification');
  });

  it('webhook action returns url and payload', () => {
    const r = makeRule({
      actions: [{ type: 'webhook', params: { url: 'https://example.com/hook', method: 'POST' } }],
      conditions: [{ type: 'price_above', params: { pair: 'BTC/USD', threshold: 45000 } }],
      maxExecutions: 5,
    });
    const result = r.trigger(createMockMarketData(), {}, []);
    expect(result.actionResults[0].success).toBe(true);
    expect(result.actionResults[0].type).toBe('webhook');
    expect(result.actionResults[0].url).toBe('https://example.com/hook');
  });

  it('unknown action type returns error', () => {
    const r = makeRule({
      actions: [{ type: 'unknown_action', params: {} }],
      conditions: [{ type: 'price_above', params: { pair: 'BTC/USD', threshold: 45000 } }],
      maxExecutions: 5,
    });
    const result = r.trigger(createMockMarketData(), {}, []);
    expect(result.actionResults[0].success).toBe(false);
  });
});

// ---------- getSummary ----------
describe('TradingRule.getSummary', () => {
  it('returns all expected fields', () => {
    const r = makeRule({ maxExecutions: 3, cooldownPeriod: 5000 });
    const summary = r.getSummary();
    expect(summary).toHaveProperty('id');
    expect(summary).toHaveProperty('userId', 'u1');
    expect(summary).toHaveProperty('name', 'Test Rule');
    expect(summary).toHaveProperty('status', 'active');
    expect(summary).toHaveProperty('maxExecutions', 3);
    expect(summary).toHaveProperty('cooldownPeriod', 5000);
    expect(summary).toHaveProperty('triggerCount', 0);
    expect(summary).toHaveProperty('conditions');
    expect(summary).toHaveProperty('actions');
  });
});

// ---------- Unknown condition type ----------
describe('TradingRule unknown condition type', () => {
  it('evaluates to false for unknown condition', () => {
    const r = makeRule({
      conditions: [{ type: 'unknown_cond', params: {} }],
    });
    const result = r.evaluate(createMockMarketData(), {}, []);
    expect(result.triggered).toBe(false);
  });
});

// ---------- Custom condition ----------
describe('TradingRule custom condition', () => {
  it('returns not met for custom condition placeholder', () => {
    const r = makeRule({
      conditions: [{ type: 'custom', params: {} }],
    });
    const result = r.evaluate(createMockMarketData(), {}, []);
    expect(result.triggered).toBe(false);
  });
});
