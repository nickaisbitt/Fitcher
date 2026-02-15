/**
 * Tests for src/services/ruleEngine.js
 */

const redis = require('../../src/utils/redis');
const logger = require('../../src/utils/logger');

// Mock redis via spyOn (vi.mock factories don't work for CJS modules)
vi.spyOn(redis, 'get').mockResolvedValue(null);
vi.spyOn(redis, 'set').mockResolvedValue('OK');
vi.spyOn(redis, 'del').mockResolvedValue(1);
vi.spyOn(redis, 'connect').mockResolvedValue(undefined);
vi.spyOn(redis, 'disconnect').mockResolvedValue(undefined);

// Mock logger to prevent output
vi.spyOn(logger, 'info').mockImplementation(() => {});
vi.spyOn(logger, 'warn').mockImplementation(() => {});
vi.spyOn(logger, 'error').mockImplementation(() => {});
vi.spyOn(logger, 'debug').mockImplementation(() => {});

// Mock eventBus to prevent side effects
const eventBus = require('../../src/utils/eventBus');
vi.spyOn(eventBus, 'subscribe').mockImplementation(() => 'sub-id');
vi.spyOn(eventBus, 'publish').mockImplementation(() => {});

const RuleEngine = require('../../src/services/ruleEngine');
const { createMockRuleConfig, createMockMarketData } = require('../helpers/fixtures');

describe('RuleEngine', () => {
  let engine;

  beforeEach(() => {
    vi.useFakeTimers();
    engine = new RuleEngine();
  });

  afterEach(() => {
    engine.stopEvaluationLoop();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------
  // createRule
  // ---------------------------------------------------------------

  describe('createRule', () => {
    it('returns success with rule data', async () => {
      const config = createMockRuleConfig();
      const result = await engine.createRule('user-1', config);

      expect(result.success).toBe(true);
      expect(result.message).toMatch(/created/i);
      expect(result.data).toBeDefined();
      expect(result.data.name).toBe(config.name);
      expect(result.data.userId).toBe('user-1');
    });

    it('stores rule in internal map', async () => {
      const config = createMockRuleConfig();
      const result = await engine.createRule('user-1', config);

      const ruleId = result.data.id;
      expect(engine.rules.has(ruleId)).toBe(true);
    });

    it('adds to user rules set', async () => {
      const config = createMockRuleConfig();
      const result = await engine.createRule('user-1', config);

      const ruleId = result.data.id;
      expect(engine.userRules.has('user-1')).toBe(true);
      expect(engine.userRules.get('user-1').has(ruleId)).toBe(true);
    });
  });

  // ---------------------------------------------------------------
  // getRule
  // ---------------------------------------------------------------

  describe('getRule', () => {
    it('returns rule from memory', async () => {
      const config = createMockRuleConfig();
      const { data } = await engine.createRule('user-1', config);

      const rule = await engine.getRule(data.id);
      expect(rule).toBeDefined();
      expect(rule.id).toBe(data.id);
    });

    it('returns null for nonexistent rule', async () => {
      const rule = await engine.getRule('nonexistent-id');
      expect(rule).toBeNull();
    });
  });

  // ---------------------------------------------------------------
  // getUserRules
  // ---------------------------------------------------------------

  describe('getUserRules', () => {
    it('returns all rules for user', async () => {
      await engine.createRule('user-1', createMockRuleConfig({ name: 'Rule A' }));
      await engine.createRule('user-1', createMockRuleConfig({ name: 'Rule B' }));
      await engine.createRule('user-2', createMockRuleConfig({ name: 'Rule C' }));

      const rules = await engine.getUserRules('user-1');
      expect(rules).toHaveLength(2);
    });

    it('filters by status', async () => {
      const { data: ruleA } = await engine.createRule('user-1', createMockRuleConfig({ name: 'Rule A' }));
      await engine.createRule('user-1', createMockRuleConfig({ name: 'Rule B' }));

      // Pause Rule A so its status is 'paused'
      await engine.pauseRule(ruleA.id);

      const activeRules = await engine.getUserRules('user-1', { status: 'active' });
      expect(activeRules).toHaveLength(1);
      expect(activeRules[0].name).toBe('Rule B');
    });

    it('returns empty for unknown user', async () => {
      const rules = await engine.getUserRules('unknown-user');
      expect(rules).toEqual([]);
    });
  });

  // ---------------------------------------------------------------
  // updateRule
  // ---------------------------------------------------------------

  describe('updateRule', () => {
    it('updates name and conditions', async () => {
      const { data } = await engine.createRule('user-1', createMockRuleConfig());
      const newConditions = [{ type: 'price_above', params: { pair: 'ETH/USD', threshold: 4000 } }];

      const result = await engine.updateRule(data.id, {
        name: 'Updated Name',
        conditions: newConditions
      });

      expect(result.success).toBe(true);
      expect(result.data.name).toBe('Updated Name');
      expect(result.data.conditions).toEqual(newConditions);
    });

    it('returns error for nonexistent rule', async () => {
      const result = await engine.updateRule('nonexistent', { name: 'Nope' });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found/i);
    });
  });

  // ---------------------------------------------------------------
  // deleteRule
  // ---------------------------------------------------------------

  describe('deleteRule', () => {
    it('removes from memory and user set', async () => {
      const { data } = await engine.createRule('user-1', createMockRuleConfig());
      const ruleId = data.id;

      const result = await engine.deleteRule(ruleId);

      expect(result.success).toBe(true);
      expect(engine.rules.has(ruleId)).toBe(false);
      expect(engine.userRules.get('user-1').has(ruleId)).toBe(false);
    });

    it('returns error for nonexistent rule', async () => {
      const result = await engine.deleteRule('nonexistent');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found/i);
    });
  });

  // ---------------------------------------------------------------
  // pauseRule / resumeRule
  // ---------------------------------------------------------------

  describe('pauseRule', () => {
    it('changes status to paused', async () => {
      const { data } = await engine.createRule('user-1', createMockRuleConfig());
      const result = await engine.pauseRule(data.id);

      expect(result.success).toBe(true);
      const rule = await engine.getRule(data.id);
      expect(rule.status).toBe('paused');
    });
  });

  describe('resumeRule', () => {
    it('changes status back to active', async () => {
      const { data } = await engine.createRule('user-1', createMockRuleConfig());
      await engine.pauseRule(data.id);
      const result = await engine.resumeRule(data.id);

      expect(result.success).toBe(true);
      const rule = await engine.getRule(data.id);
      expect(rule.status).toBe('active');
    });
  });

  // ---------------------------------------------------------------
  // evaluateRules
  // ---------------------------------------------------------------

  describe('evaluateRules', () => {
    it('skips inactive rules', async () => {
      const { data } = await engine.createRule('user-1', createMockRuleConfig());
      await engine.pauseRule(data.id);

      const marketData = createMockMarketData();
      const triggered = await engine.evaluateRules(marketData, {}, {});

      expect(triggered).toHaveLength(0);
    });

    it('prevents overlapping evaluations (isProcessing guard)', async () => {
      const config = createMockRuleConfig({
        conditions: [
          { type: 'price_above', params: { pair: 'BTC/USD', threshold: 1 } }
        ]
      });
      await engine.createRule('user-1', config);
      const marketData = createMockMarketData();

      // Set isProcessing to true before calling
      engine.isProcessing = true;

      const triggered = await engine.evaluateRules(marketData, {}, {});
      expect(triggered).toEqual([]);

      // Clean up
      engine.isProcessing = false;
    });

    it('emits ruleTriggered event when rule fires', async () => {
      const config = createMockRuleConfig({
        conditions: [
          { type: 'price_above', params: { pair: 'BTC/USD', threshold: 1 } }
        ],
        actions: [
          { type: 'send_notification', params: { message: 'Price is high!' } }
        ],
        maxExecutions: 10
      });
      await engine.createRule('user-1', config);

      const emitSpy = vi.spyOn(engine, 'emit');
      const marketData = createMockMarketData();

      const triggered = await engine.evaluateRules(marketData, {}, {});

      expect(triggered.length).toBeGreaterThan(0);
      expect(emitSpy).toHaveBeenCalledWith('ruleTriggered', expect.objectContaining({
        timestamp: expect.any(Number)
      }));
    });

    it('continues evaluating after one rule errors', async () => {
      const { data: ruleA } = await engine.createRule('user-1', createMockRuleConfig({
        name: 'Bad Rule',
        conditions: [{ type: 'price_above', params: { pair: 'BTC/USD', threshold: 1 } }],
        maxExecutions: 10
      }));
      const { data: ruleB } = await engine.createRule('user-1', createMockRuleConfig({
        name: 'Good Rule',
        conditions: [{ type: 'price_above', params: { pair: 'BTC/USD', threshold: 1 } }],
        maxExecutions: 10
      }));

      // Sabotage rule A's trigger method
      const ruleAObj = engine.rules.get(ruleA.id);
      ruleAObj.trigger = () => { throw new Error('Boom'); };

      const marketData = createMockMarketData();
      const triggered = await engine.evaluateRules(marketData, {}, {});

      // Rule B should still have been evaluated (and triggered)
      expect(triggered.length).toBeGreaterThanOrEqual(1);
      expect(triggered.some(r => r.ruleId === ruleB.id)).toBe(true);
    });
  });

  // ---------------------------------------------------------------
  // startEvaluationLoop
  // ---------------------------------------------------------------

  describe('startEvaluationLoop', () => {
    it('will NOT use mock data - no fallback to generateMockMarketData', async () => {
      engine.startEvaluationLoop();

      const evalSpy = vi.spyOn(engine, 'evaluateRules');

      // Advance timer past one evaluation cycle (10s)
      await vi.advanceTimersByTimeAsync(10500);

      // Without real market data, evaluateRules should NOT have been called
      expect(evalSpy).not.toHaveBeenCalled();

      // Verify that the loop doesn't fall back to mock data
      expect(engine.lastMarketData).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------
  // stopEvaluationLoop
  // ---------------------------------------------------------------

  describe('stopEvaluationLoop', () => {
    it('clears interval', () => {
      engine.startEvaluationLoop();
      expect(engine.evaluationInterval).not.toBeNull();

      engine.stopEvaluationLoop();
      expect(engine.evaluationInterval).toBeNull();
      expect(engine.isRunning).toBe(false);
    });
  });

  // ---------------------------------------------------------------
  // getStatus
  // ---------------------------------------------------------------

  describe('getStatus', () => {
    it('returns correct counts', async () => {
      await engine.createRule('user-1', createMockRuleConfig({ name: 'Rule A' }));
      const { data: ruleB } = await engine.createRule('user-1', createMockRuleConfig({ name: 'Rule B' }));
      await engine.createRule('user-2', createMockRuleConfig({ name: 'Rule C' }));

      await engine.pauseRule(ruleB.id);

      const status = engine.getStatus();

      expect(status.totalRules).toBe(3);
      expect(status.activeRules).toBe(2);
      expect(status.totalUsers).toBe(2);
    });
  });

  // ---------------------------------------------------------------
  // shutdown
  // ---------------------------------------------------------------

  describe('shutdown', () => {
    it('stops evaluation loop', async () => {
      engine.startEvaluationLoop();
      await engine.shutdown();

      expect(engine.evaluationInterval).toBeNull();
    });

    it('persists all rules', async () => {
      await engine.createRule('user-1', createMockRuleConfig({ name: 'Rule A' }));
      await engine.createRule('user-2', createMockRuleConfig({ name: 'Rule B' }));

      redis.set.mockClear();
      await engine.shutdown();

      // Each rule should be persisted during shutdown
      expect(redis.set).toHaveBeenCalledTimes(2);
    });
  });
});
