/**
 * Tests for src/services/enhancedRiskManager.js
 */

const logger = require('../../src/utils/logger');
const redis = require('../../src/utils/redis');

// Mock redis
vi.spyOn(redis, 'get').mockResolvedValue(null);
vi.spyOn(redis, 'set').mockResolvedValue('OK');
vi.spyOn(redis, 'del').mockResolvedValue(1);
vi.spyOn(redis, 'connect').mockResolvedValue(undefined);
vi.spyOn(redis, 'disconnect').mockResolvedValue(undefined);

// Mock logger
vi.spyOn(logger, 'info').mockImplementation(() => {});
vi.spyOn(logger, 'warn').mockImplementation(() => {});
vi.spyOn(logger, 'error').mockImplementation(() => {});
vi.spyOn(logger, 'debug').mockImplementation(() => {});

// Mock eventBus
const eventBus = require('../../src/utils/eventBus');
vi.spyOn(eventBus, 'subscribe').mockImplementation(() => 'sub-id');
vi.spyOn(eventBus, 'publish').mockImplementation(() => {});

const EnhancedRiskManager = require('../../src/services/enhancedRiskManager');

describe('EnhancedRiskManager', () => {
  let rm;

  beforeEach(() => {
    rm = new EnhancedRiskManager();
    vi.clearAllMocks();
    // Restore logger mocks after clearAllMocks
    logger.info.mockImplementation(() => {});
    logger.warn.mockImplementation(() => {});
    logger.error.mockImplementation(() => {});
    logger.debug.mockImplementation(() => {});
    redis.get.mockResolvedValue(null);
    redis.set.mockResolvedValue('OK');
    redis.del.mockResolvedValue(1);
    eventBus.subscribe.mockImplementation(() => 'sub-id');
    eventBus.publish.mockImplementation(() => {});
  });

  // ---------------------------------------------------------------
  // constructor
  // ---------------------------------------------------------------

  describe('constructor', () => {
    it('sets default config', () => {
      expect(rm.config.maxPositionSize).toBe(0.2);
      expect(rm.config.maxTotalExposure).toBe(0.8);
      expect(rm.config.maxDailyLoss).toBe(0.05);
      expect(rm.config.maxDrawdownPercent).toBe(10);
      expect(rm.config.circuitBreakerDuration).toBe(3600000);
      expect(rm.config.maxConsecutiveLosses).toBe(5);
    });
  });

  // ---------------------------------------------------------------
  // checkTrade — allowed
  // ---------------------------------------------------------------

  describe('checkTrade', () => {
    it('allows trade within all limits', async () => {
      const trade = { pair: 'BTC/USD', amount: 0.01, price: 50000 };
      const portfolio = { totalValue: 100000, totalExposure: 0, positions: [] };

      const result = await rm.checkTrade('user-1', trade, portfolio);

      expect(result.allowed).toBe(true);
      expect(result.failedChecks).toHaveLength(0);
    });

    // ---------------------------------------------------------------
    // checkTrade — position size
    // ---------------------------------------------------------------

    it('blocks trade exceeding max position size', async () => {
      // Trade value = 30000 = 30% of 100k; limit is 20%
      const trade = { pair: 'BTC/USD', amount: 0.6, price: 50000 };
      const portfolio = { totalValue: 100000, totalExposure: 0, positions: [] };

      const result = await rm.checkTrade('user-1', trade, portfolio);

      expect(result.allowed).toBe(false);
      const posCheck = result.failedChecks.find(c => c.check === 'positionSize');
      expect(posCheck).toBeDefined();
    });

    // ---------------------------------------------------------------
    // checkTrade — portfolio exposure
    // ---------------------------------------------------------------

    it('blocks trade exceeding portfolio exposure', async () => {
      // Existing exposure 75k + trade 10k = 85k = 85% > 80% limit
      const trade = { pair: 'BTC/USD', amount: 0.2, price: 50000 };
      const portfolio = { totalValue: 100000, totalExposure: 75000, positions: [] };

      const result = await rm.checkTrade('user-1', trade, portfolio);

      expect(result.allowed).toBe(false);
      const expCheck = result.failedChecks.find(c => c.check === 'exposure');
      expect(expCheck).toBeDefined();
    });

    // ---------------------------------------------------------------
    // checkTrade — max positions count (via daily trade limit)
    // ---------------------------------------------------------------

    it('blocks trade exceeding max positions count (daily trades)', async () => {
      const rmLimited = new EnhancedRiskManager({ maxDailyTrades: 2 });

      const trade = { pair: 'BTC/USD', amount: 0.01, price: 50000 };
      const portfolio = { totalValue: 100000, totalExposure: 0, positions: [] };

      // Simulate 2 prior trades
      rmLimited.initializeUser('user-1', 100000);
      const userData = rmLimited.userData.get('user-1');
      userData.dailyStats.tradeCount = 2;

      const result = await rmLimited.checkTrade('user-1', trade, portfolio);

      expect(result.allowed).toBe(false);
      const dailyCheck = result.failedChecks.find(c => c.check === 'dailyLimits');
      expect(dailyCheck).toBeDefined();
    });

    // ---------------------------------------------------------------
    // checkTrade — daily loss limit
    // ---------------------------------------------------------------

    it('blocks trade exceeding daily loss limit', async () => {
      const trade = { pair: 'BTC/USD', amount: 0.01, price: 50000 };
      const portfolio = { totalValue: 100000, totalExposure: 0, positions: [] };

      // Simulate daily losses exceeding 5% of 100k = $5000
      rm.initializeUser('user-1', 100000);
      const userData = rm.userData.get('user-1');
      userData.dailyStats.realizedPnL = -6000;

      const result = await rm.checkTrade('user-1', trade, portfolio);

      expect(result.allowed).toBe(false);
      const dailyCheck = result.failedChecks.find(c => c.check === 'dailyLimits');
      expect(dailyCheck).toBeDefined();
    });

    // ---------------------------------------------------------------
    // checkTrade — circuit breaker active
    // ---------------------------------------------------------------

    it('blocks when circuit breaker is active', async () => {
      const trade = { pair: 'BTC/USD', amount: 0.01, price: 50000 };
      const portfolio = { totalValue: 100000, totalExposure: 0, positions: [] };

      rm.circuitBreakers.set('user-1', {
        active: true,
        triggeredAt: Date.now(),
        duration: 3600000
      });

      const result = await rm.checkTrade('user-1', trade, portfolio);

      expect(result.allowed).toBe(false);
      const cbCheck = result.failedChecks.find(c => c.check === 'circuitBreaker');
      expect(cbCheck).toBeDefined();
    });

    // ---------------------------------------------------------------
    // checkTrade — returns all failed checks
    // ---------------------------------------------------------------

    it('returns all failed checks (not just first)', async () => {
      // Trade value = 30k = 30% > 20% limit (positionSize fail)
      // Plus existing exposure 75k + 30k = 105k > 80% (exposure fail)
      const trade = { pair: 'BTC/USD', amount: 0.6, price: 50000 };
      const portfolio = { totalValue: 100000, totalExposure: 75000, positions: [] };

      const result = await rm.checkTrade('user-1', trade, portfolio);

      expect(result.allowed).toBe(false);
      expect(result.failedChecks.length).toBeGreaterThanOrEqual(2);

      const checkNames = result.failedChecks.map(c => c.check);
      expect(checkNames).toContain('positionSize');
      expect(checkNames).toContain('exposure');
    });

    // ---------------------------------------------------------------
    // checkTrade — missing portfolio
    // ---------------------------------------------------------------

    it('handles missing portfolio data gracefully', async () => {
      const trade = { pair: 'BTC/USD', amount: 0.001, price: 50000 };

      // Pass empty portfolio — should use defaults, not crash
      const result = await rm.checkTrade('user-1', trade, {});
      expect(result).toBeDefined();
      expect(typeof result.allowed).toBe('boolean');
    });

    // ---------------------------------------------------------------
    // checkTrade — missing trade data
    // ---------------------------------------------------------------

    it('handles missing trade data gracefully', async () => {
      const portfolio = { totalValue: 100000, totalExposure: 0, positions: [] };

      // Pass minimal trade — should not crash
      const result = await rm.checkTrade('user-1', {}, portfolio);
      expect(result).toBeDefined();
      expect(typeof result.allowed).toBe('boolean');
    });
  });

  // ---------------------------------------------------------------
  // updateUserConfig (via constructor config)
  // ---------------------------------------------------------------

  describe('updateUserConfig', () => {
    it('updates risk limits for user', () => {
      const rmCustom = new EnhancedRiskManager({ maxPositionSize: 0.1 });
      expect(rmCustom.config.maxPositionSize).toBe(0.1);

      // Update config
      rmCustom.config.maxPositionSize = 0.3;
      expect(rmCustom.config.maxPositionSize).toBe(0.3);
    });
  });

  // ---------------------------------------------------------------
  // per-pair limits (concentration)
  // ---------------------------------------------------------------

  describe('per-pair limits', () => {
    it('respects pair-specific max position (concentration)', async () => {
      const rmTight = new EnhancedRiskManager({ maxConcentration: 0.1 });

      // Trade value = 15k = 15% concentration > 10% limit
      const trade = { pair: 'BTC/USD', amount: 0.3, price: 50000 };
      const portfolio = {
        totalValue: 100000,
        totalExposure: 0,
        positions: []
      };

      const result = await rmTight.checkTrade('user-1', trade, portfolio);

      expect(result.allowed).toBe(false);
      const concCheck = result.failedChecks.find(c => c.check === 'concentration');
      expect(concCheck).toBeDefined();
    });
  });

  // ---------------------------------------------------------------
  // circuit breaker
  // ---------------------------------------------------------------

  describe('circuit breaker', () => {
    it('triggers on drawdown threshold', async () => {
      const rmCb = new EnhancedRiskManager({ maxDrawdownPercent: 5 });

      // Peak was 100k, now 90k = 10% drawdown > 5% threshold
      rmCb.initializeUser('user-1', 100000);
      rmCb.peakEquity.set('user-1', 100000);

      const trade = { pair: 'BTC/USD', amount: 0.01, price: 50000 };
      const portfolio = { totalValue: 90000, totalExposure: 0, positions: [] };

      const result = await rmCb.checkTrade('user-1', trade, portfolio);

      expect(result.allowed).toBe(false);
      const ddCheck = result.failedChecks.find(c => c.check === 'drawdown');
      expect(ddCheck).toBeDefined();

      // Circuit breaker should have been triggered (drawdown is a critical failure)
      expect(rmCb.circuitBreakers.has('user-1')).toBe(true);
    });

    it('emits event when triggered', async () => {
      const emitSpy = vi.spyOn(rm, 'emit');

      rm.triggerCircuitBreaker('user-1', [{ check: 'drawdown', reason: 'test' }]);

      expect(emitSpy).toHaveBeenCalledWith('circuitBreakerTriggered', expect.objectContaining({
        userId: 'user-1',
        reasons: expect.any(Array),
        duration: expect.any(Number)
      }));
    });

    it('resets after cooldown period', async () => {
      // Set circuit breaker that triggered 2 hours ago (> 1 hour default duration)
      rm.circuitBreakers.set('user-1', {
        active: true,
        triggeredAt: Date.now() - 7200000, // 2 hours ago
        duration: 3600000
      });

      const result = rm.checkCircuitBreaker('user-1');

      expect(result.allowed).toBe(true);
      // Circuit breaker should have been cleared
      expect(rm.circuitBreakers.has('user-1')).toBe(false);
    });
  });

  // ---------------------------------------------------------------
  // portfolio exposure
  // ---------------------------------------------------------------

  describe('portfolio exposure', () => {
    it('calculates correctly with existing positions', async () => {
      // Current exposure 60k + trade 25k = 85k = 85% > 80%
      const trade = { pair: 'ETH/USD', amount: 5, price: 5000 };
      const portfolio = {
        totalValue: 100000,
        totalExposure: 60000,
        positions: [{ asset: 'BTC', totalValue: 60000 }]
      };

      const result = await rm.checkTrade('user-1', trade, portfolio);

      expect(result.allowed).toBe(false);
      expect(result.failedChecks.find(c => c.check === 'exposure')).toBeDefined();
    });
  });

  // ---------------------------------------------------------------
  // max open positions (daily trade count)
  // ---------------------------------------------------------------

  describe('max open positions', () => {
    it('counts correctly', async () => {
      const rmLimit = new EnhancedRiskManager({ maxDailyTrades: 3 });

      const trade = { pair: 'BTC/USD', amount: 0.01, price: 50000 };
      const portfolio = { totalValue: 100000, totalExposure: 0, positions: [] };

      rmLimit.initializeUser('user-1', 100000);
      const userData = rmLimit.userData.get('user-1');
      userData.dailyStats.tradeCount = 3;

      const result = await rmLimit.checkTrade('user-1', trade, portfolio);

      expect(result.allowed).toBe(false);
      const dailyCheck = result.failedChecks.find(c => c.check === 'dailyLimits');
      expect(dailyCheck).toBeDefined();
      expect(dailyCheck.reason).toMatch(/trade limit/i);
    });
  });

  // ---------------------------------------------------------------
  // daily loss tracking
  // ---------------------------------------------------------------

  describe('daily loss tracking', () => {
    it('tracks losses within 24h window', async () => {
      const trade = { pair: 'BTC/USD', amount: 0.01, price: 50000 };
      const portfolio = { totalValue: 100000, totalExposure: 0, positions: [] };

      // Simulate losses
      rm.initializeUser('user-1', 100000);
      const userData = rm.userData.get('user-1');
      userData.dailyStats.realizedPnL = -4000; // under $5000 limit

      let result = await rm.checkTrade('user-1', trade, portfolio);
      // Should still be allowed (daily loss check should pass)
      const dailyFail = result.failedChecks.find(c => c.check === 'dailyLimits');
      expect(dailyFail).toBeUndefined();

      // Push over limit
      userData.dailyStats.realizedPnL = -6000;
      result = await rm.checkTrade('user-1', trade, portfolio);
      expect(result.failedChecks.find(c => c.check === 'dailyLimits')).toBeDefined();
    });

    it('resets after window expires (new day)', async () => {
      const trade = { pair: 'BTC/USD', amount: 0.01, price: 50000 };
      const portfolio = { totalValue: 100000, totalExposure: 0, positions: [] };

      rm.initializeUser('user-1', 100000);
      const userData = rm.userData.get('user-1');
      // Set daily stats from "yesterday" with heavy losses
      userData.dailyStats.realizedPnL = -6000;
      userData.dailyStats.date = new Date(Date.now() - 86400000).toDateString(); // yesterday

      const result = await rm.checkTrade('user-1', trade, portfolio);

      // Daily stats should have been reset because the date changed.
      // Check specifically that dailyLimits passed.
      // Note: the fresh dailyStats will have realizedPnL=0, tradeCount=0
      const userData2 = rm.userData.get('user-1');
      expect(userData2.dailyStats.realizedPnL).toBe(0);
      expect(userData2.dailyStats.tradeCount).toBe(0);
    });
  });

  // ---------------------------------------------------------------
  // multiple users
  // ---------------------------------------------------------------

  describe('multiple users', () => {
    it('maintains separate state per user', async () => {
      const trade = { pair: 'BTC/USD', amount: 0.01, price: 50000 };
      const portfolio = { totalValue: 100000, totalExposure: 0, positions: [] };

      // Block user-1 with circuit breaker
      rm.circuitBreakers.set('user-1', {
        active: true,
        triggeredAt: Date.now(),
        duration: 3600000
      });

      const result1 = await rm.checkTrade('user-1', trade, portfolio);
      const result2 = await rm.checkTrade('user-2', trade, portfolio);

      expect(result1.allowed).toBe(false);
      expect(result2.allowed).toBe(true);
    });
  });

  // ---------------------------------------------------------------
  // concurrent checks
  // ---------------------------------------------------------------

  describe('concurrent checks', () => {
    it('handles rapid sequential calls', async () => {
      const trade = { pair: 'BTC/USD', amount: 0.01, price: 50000 };
      const portfolio = { totalValue: 100000, totalExposure: 0, positions: [] };

      // Fire multiple checks rapidly
      const results = await Promise.all([
        rm.checkTrade('user-1', trade, portfolio),
        rm.checkTrade('user-1', trade, portfolio),
        rm.checkTrade('user-1', trade, portfolio),
        rm.checkTrade('user-2', trade, portfolio),
        rm.checkTrade('user-3', trade, portfolio)
      ]);

      expect(results).toHaveLength(5);
      results.forEach(r => {
        expect(r).toBeDefined();
        expect(typeof r.allowed).toBe('boolean');
        expect(r.failedChecks).toBeDefined();
      });
    });
  });

  // ---------------------------------------------------------------
  // handleTrade — tracking
  // ---------------------------------------------------------------

  describe('handleTrade', () => {
    it('updates daily stats on trade completion', () => {
      rm.initializeUser('user-1', 100000);

      rm.handleTrade({
        userId: 'user-1',
        order: {
          filledAmount: 0.1,
          averagePrice: 50000,
          fee: 5,
          side: 'buy'
        }
      });

      const userData = rm.userData.get('user-1');
      expect(userData.dailyStats.tradeCount).toBe(1);
      expect(userData.dailyStats.volume).toBe(5000);
      expect(userData.dailyStats.fees).toBe(5);
    });

    it('tracks consecutive losses', () => {
      rm.initializeUser('user-1', 100000);

      // Record 3 consecutive losses
      for (let i = 0; i < 3; i++) {
        rm.handleTrade({
          userId: 'user-1',
          order: {
            filledAmount: 0.1,
            averagePrice: 50000,
            fee: 5,
            side: 'sell',
            realizedPnL: -100
          }
        });
      }

      expect(rm.consecutiveLosses.get('user-1')).toBe(3);

      // A winning trade resets the count
      rm.handleTrade({
        userId: 'user-1',
        order: {
          filledAmount: 0.1,
          averagePrice: 50000,
          fee: 5,
          side: 'sell',
          realizedPnL: 200
        }
      });

      expect(rm.consecutiveLosses.get('user-1')).toBe(0);
    });
  });

  // ---------------------------------------------------------------
  // checkConsecutiveLosses
  // ---------------------------------------------------------------

  describe('checkConsecutiveLosses', () => {
    it('blocks when max consecutive losses reached', async () => {
      rm.initializeUser('user-1', 100000);
      rm.consecutiveLosses.set('user-1', 5);

      const trade = { pair: 'BTC/USD', amount: 0.01, price: 50000 };
      const portfolio = { totalValue: 100000, totalExposure: 0, positions: [] };

      const result = await rm.checkTrade('user-1', trade, portfolio);

      expect(result.allowed).toBe(false);
      const consCheck = result.failedChecks.find(c => c.check === 'consecutiveLosses');
      expect(consCheck).toBeDefined();
    });
  });

  // ---------------------------------------------------------------
  // getRiskStatus
  // ---------------------------------------------------------------

  describe('getRiskStatus', () => {
    it('returns full status object', () => {
      rm.initializeUser('user-1', 100000);

      const status = rm.getRiskStatus('user-1', { totalValue: 95000 });

      expect(status.userId).toBe('user-1');
      expect(status.drawdown).toBeDefined();
      expect(status.drawdown.peak).toBe(100000);
      expect(status.limits).toBeDefined();
      expect(status.usage).toBeDefined();
    });
  });

  // ---------------------------------------------------------------
  // resetCircuitBreaker
  // ---------------------------------------------------------------

  describe('resetCircuitBreaker', () => {
    it('removes circuit breaker for user', () => {
      rm.circuitBreakers.set('user-1', {
        active: true,
        triggeredAt: Date.now(),
        duration: 3600000
      });

      rm.resetCircuitBreaker('user-1');

      expect(rm.circuitBreakers.has('user-1')).toBe(false);
    });
  });

  // ---------------------------------------------------------------
  // getActiveCircuitBreakers
  // ---------------------------------------------------------------

  describe('getActiveCircuitBreakers', () => {
    it('lists all active breakers', () => {
      rm.circuitBreakers.set('user-1', { active: true, triggeredAt: Date.now(), duration: 3600000 });
      rm.circuitBreakers.set('user-2', { active: true, triggeredAt: Date.now(), duration: 3600000 });

      const active = rm.getActiveCircuitBreakers();
      expect(active).toHaveLength(2);
      expect(active[0].userId).toBeDefined();
    });
  });

  // ---------------------------------------------------------------
  // slippage check
  // ---------------------------------------------------------------

  describe('slippage check', () => {
    it('blocks excessive slippage', async () => {
      const trade = {
        pair: 'BTC/USD',
        amount: 0.01,
        price: 50000,
        expectedPrice: 50000,
        executionPrice: 52000 // 4% slippage > 2% limit
      };
      const portfolio = { totalValue: 100000, totalExposure: 0, positions: [] };

      const result = await rm.checkTrade('user-1', trade, portfolio);

      expect(result.allowed).toBe(false);
      const slipCheck = result.failedChecks.find(c => c.check === 'slippage');
      expect(slipCheck).toBeDefined();
    });
  });

  // ---------------------------------------------------------------
  // cooldown check
  // ---------------------------------------------------------------

  describe('cooldown check', () => {
    it('blocks trade during cooldown period', async () => {
      const trade = { pair: 'BTC/USD', amount: 0.01, price: 50000 };
      const portfolio = { totalValue: 100000, totalExposure: 0, positions: [] };

      rm.initializeUser('user-1', 100000);
      const userData = rm.userData.get('user-1');
      userData.lastTradeTime = Date.now(); // Just traded

      const result = await rm.checkTrade('user-1', trade, portfolio);

      expect(result.allowed).toBe(false);
      const coolCheck = result.failedChecks.find(c => c.check === 'cooldown');
      expect(coolCheck).toBeDefined();
    });
  });
});
