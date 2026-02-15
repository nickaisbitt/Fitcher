/**
 * Tests for src/services/strategyManager.js
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

const StrategyManager = require('../../src/services/strategyManager');
const { createMockStrategyConfig, createMockMarketData } = require('../helpers/fixtures');

describe('StrategyManager', () => {
  let manager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new StrategyManager();
  });

  afterEach(() => {
    manager.stopExecutionLoop();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------
  // createStrategy
  // ---------------------------------------------------------------

  describe('createStrategy', () => {
    it('returns success', async () => {
      const config = createMockStrategyConfig();
      const result = await manager.createStrategy('user-1', config);

      expect(result.success).toBe(true);
      expect(result.message).toMatch(/created/i);
      expect(result.data).toBeDefined();
      expect(result.data.name).toBe(config.name);
    });

    it('stores in internal map', async () => {
      const config = createMockStrategyConfig();
      const result = await manager.createStrategy('user-1', config);

      expect(manager.strategies.has(result.data.id)).toBe(true);
    });

    it('adds to user strategies', async () => {
      const config = createMockStrategyConfig();
      const result = await manager.createStrategy('user-1', config);

      expect(manager.userStrategies.has('user-1')).toBe(true);
      expect(manager.userStrategies.get('user-1').has(result.data.id)).toBe(true);
    });
  });

  // ---------------------------------------------------------------
  // getStrategy
  // ---------------------------------------------------------------

  describe('getStrategy', () => {
    it('returns from memory', async () => {
      const { data } = await manager.createStrategy('user-1', createMockStrategyConfig());
      const strategy = await manager.getStrategy(data.id);

      expect(strategy).toBeDefined();
      expect(strategy.id).toBe(data.id);
    });

    it('returns null for nonexistent', async () => {
      const strategy = await manager.getStrategy('nonexistent-id');
      expect(strategy).toBeNull();
    });
  });

  // ---------------------------------------------------------------
  // getUserStrategies
  // ---------------------------------------------------------------

  describe('getUserStrategies', () => {
    it('returns all for user', async () => {
      await manager.createStrategy('user-1', createMockStrategyConfig({ name: 'Strat A' }));
      await manager.createStrategy('user-1', createMockStrategyConfig({ name: 'Strat B' }));
      await manager.createStrategy('user-2', createMockStrategyConfig({ name: 'Strat C' }));

      const strategies = await manager.getUserStrategies('user-1');
      expect(strategies).toHaveLength(2);
    });

    it('filters by status and type', async () => {
      const { data: stratA } = await manager.createStrategy('user-1', createMockStrategyConfig({ name: 'Strat A', type: 'momentum' }));
      await manager.createStrategy('user-1', createMockStrategyConfig({ name: 'Strat B', type: 'grid' }));

      // Activate Strat A so its status changes to 'active'
      await manager.activateStrategy(stratA.id);

      const active = await manager.getUserStrategies('user-1', { status: 'active' });
      expect(active).toHaveLength(1);
      expect(active[0].name).toBe('Strat A');

      const gridStrategies = await manager.getUserStrategies('user-1', { type: 'grid' });
      expect(gridStrategies).toHaveLength(1);
      expect(gridStrategies[0].name).toBe('Strat B');
    });

    it('returns empty for unknown user', async () => {
      const strategies = await manager.getUserStrategies('unknown-user');
      expect(strategies).toEqual([]);
    });
  });

  // ---------------------------------------------------------------
  // activateStrategy
  // ---------------------------------------------------------------

  describe('activateStrategy', () => {
    it('sets status active', async () => {
      const { data } = await manager.createStrategy('user-1', createMockStrategyConfig());
      const result = await manager.activateStrategy(data.id);

      expect(result.success).toBe(true);
      const strategy = await manager.getStrategy(data.id);
      expect(strategy.status).toBe('active');
    });

    it('returns error for nonexistent', async () => {
      const result = await manager.activateStrategy('nonexistent');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found/i);
    });
  });

  // ---------------------------------------------------------------
  // deactivateStrategy
  // ---------------------------------------------------------------

  describe('deactivateStrategy', () => {
    it('sets status inactive', async () => {
      const { data } = await manager.createStrategy('user-1', createMockStrategyConfig());
      await manager.activateStrategy(data.id);
      const result = await manager.deactivateStrategy(data.id);

      expect(result.success).toBe(true);
      const strategy = await manager.getStrategy(data.id);
      expect(strategy.status).toBe('inactive');
    });
  });

  // ---------------------------------------------------------------
  // pauseStrategy / resumeStrategy
  // ---------------------------------------------------------------

  describe('pauseStrategy', () => {
    it('changes status to paused', async () => {
      const { data } = await manager.createStrategy('user-1', createMockStrategyConfig());
      await manager.activateStrategy(data.id);
      const result = await manager.pauseStrategy(data.id);

      expect(result.success).toBe(true);
      const strategy = await manager.getStrategy(data.id);
      expect(strategy.status).toBe('paused');
    });
  });

  describe('resumeStrategy', () => {
    it('changes status back to active', async () => {
      const { data } = await manager.createStrategy('user-1', createMockStrategyConfig());
      await manager.activateStrategy(data.id);
      await manager.pauseStrategy(data.id);
      const result = await manager.resumeStrategy(data.id);

      expect(result.success).toBe(true);
      const strategy = await manager.getStrategy(data.id);
      expect(strategy.status).toBe('active');
    });
  });

  // ---------------------------------------------------------------
  // updateStrategy
  // ---------------------------------------------------------------

  describe('updateStrategy', () => {
    it('updates parameters', async () => {
      const { data } = await manager.createStrategy('user-1', createMockStrategyConfig());
      const result = await manager.updateStrategy(data.id, {
        parameters: { fastEma: 8, slowEma: 21 }
      });

      expect(result.success).toBe(true);
      const strategy = await manager.getStrategy(data.id);
      expect(strategy.parameters.fastEma).toBe(8);
      expect(strategy.parameters.slowEma).toBe(21);
    });

    it('updates name', async () => {
      const { data } = await manager.createStrategy('user-1', createMockStrategyConfig());
      const result = await manager.updateStrategy(data.id, { name: 'New Name' });

      expect(result.success).toBe(true);
      expect(result.data.name).toBe('New Name');
    });

    it('returns error for nonexistent', async () => {
      const result = await manager.updateStrategy('nonexistent', { name: 'Nope' });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found/i);
    });
  });

  // ---------------------------------------------------------------
  // deleteStrategy
  // ---------------------------------------------------------------

  describe('deleteStrategy', () => {
    it('removes from memory', async () => {
      const { data } = await manager.createStrategy('user-1', createMockStrategyConfig());
      const result = await manager.deleteStrategy(data.id);

      expect(result.success).toBe(true);
      expect(manager.strategies.has(data.id)).toBe(false);
      expect(manager.userStrategies.get('user-1').has(data.id)).toBe(false);
    });

    it('returns error for nonexistent', async () => {
      const result = await manager.deleteStrategy('nonexistent');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found/i);
    });
  });

  // ---------------------------------------------------------------
  // executeStrategies
  // ---------------------------------------------------------------

  describe('executeStrategies', () => {
    it('prevents overlapping (isProcessing guard)', async () => {
      const { data } = await manager.createStrategy('user-1', createMockStrategyConfig());
      await manager.activateStrategy(data.id);

      manager.isProcessing = true;
      const marketData = createMockMarketData();

      const result = await manager.executeStrategies(marketData);
      expect(result).toBeUndefined();

      manager.isProcessing = false;
    });

    it('skips inactive strategies', async () => {
      await manager.createStrategy('user-1', createMockStrategyConfig());
      // Strategy starts as 'inactive' - do NOT activate

      const emitSpy = vi.spyOn(manager, 'emit');
      const marketData = createMockMarketData();

      await manager.executeStrategies(marketData);

      expect(emitSpy).not.toHaveBeenCalledWith('strategySignal', expect.anything());
    });
  });

  // ---------------------------------------------------------------
  // startExecutionLoop
  // ---------------------------------------------------------------

  describe('startExecutionLoop', () => {
    it('will NOT use mock data (our bug fix)', async () => {
      manager.startExecutionLoop();

      const execSpy = vi.spyOn(manager, 'executeStrategies');

      // Advance past one execution cycle (30s)
      await vi.advanceTimersByTimeAsync(31000);

      // Without real market data, executeStrategies should NOT be called
      expect(execSpy).not.toHaveBeenCalled();
      expect(manager.lastMarketData).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------
  // stopExecutionLoop
  // ---------------------------------------------------------------

  describe('stopExecutionLoop', () => {
    it('clears interval', () => {
      manager.startExecutionLoop();
      expect(manager.executionInterval).not.toBeNull();

      manager.stopExecutionLoop();
      expect(manager.executionInterval).toBeNull();
    });
  });

  // ---------------------------------------------------------------
  // getActiveStrategiesCount
  // ---------------------------------------------------------------

  describe('getActiveStrategiesCount', () => {
    it('returns correct count', async () => {
      const { data: s1 } = await manager.createStrategy('user-1', createMockStrategyConfig());
      const { data: s2 } = await manager.createStrategy('user-1', createMockStrategyConfig());
      await manager.createStrategy('user-1', createMockStrategyConfig());

      await manager.activateStrategy(s1.id);
      await manager.activateStrategy(s2.id);

      expect(manager.getActiveStrategiesCount()).toBe(2);
    });
  });

  // ---------------------------------------------------------------
  // shutdown
  // ---------------------------------------------------------------

  describe('shutdown', () => {
    it('stops loop and persists', async () => {
      manager.startExecutionLoop();

      await manager.createStrategy('user-1', createMockStrategyConfig({ name: 'A' }));
      await manager.createStrategy('user-2', createMockStrategyConfig({ name: 'B' }));

      redis.set.mockClear();
      await manager.shutdown();

      expect(manager.executionInterval).toBeNull();
      expect(redis.set).toHaveBeenCalledTimes(2);
    });
  });

  // ---------------------------------------------------------------
  // getStrategyPerformance
  // ---------------------------------------------------------------

  describe('getStrategyPerformance', () => {
    it('returns null for nonexistent', async () => {
      const perf = await manager.getStrategyPerformance('nonexistent');
      expect(perf).toBeNull();
    });
  });
});
