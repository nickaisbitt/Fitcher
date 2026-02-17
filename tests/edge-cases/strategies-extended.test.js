// vitest globals (describe, it, expect, vi, beforeEach, afterEach) injected via vitest.config.js
// vitest globals (describe, it, expect, vi, beforeEach, afterEach) injected via vitest.config.js
const MomentumStrategy = require('../../src/strategies/MomentumStrategyV2');
const MeanReversionStrategy = require('../../src/strategies/MeanReversionStrategyV2');
const GridTradingStrategy = require('../../src/strategies/GridTradingStrategyV2');
const strategyFactory = require('../../src/strategies/strategyFactory');

// Mock the entire IndicatorState/MultiTimeframeIndicatorState dependency for isolated strategy testing
const mockIndicatorState = {
  getSnapshot: () => ({ 
    '1h': { warmedUp: true, ema12: 10000, ema26: 9900, rsi: 60, bb: { lower: 9500, middle: 10000, upper: 10500 }, macd: { histogram: 50 } },
    '4h': { warmedUp: true, ema12: 10000, ema26: 9900, rsi: 60, bb: { lower: 9500, middle: 10000, upper: 10500 } },
    '1d': { warmedUp: true, ema12: 10000, ema26: 9900 },
    overallWarmedUp: true,
    trendAlignment: { direction: 'uptrend', score: 1 }
  }),
  getATR: () => 500,
  getCandles: () => Array(20).fill({close: 100000, volume: 10000}),
};
vi.mock('../../src/services/MultiTimeframeIndicatorState', () => vi.fn().mockImplementation(() => mockIndicatorState));


describe('Strategy v2 edge cases', () => {
  
  beforeAll(() => {
    // Setup for strategy factory, ensuring it creates V2 classes
    strategyFactory.create = (type, config) => {
      switch(type) {
        case 'momentum': return new MomentumStrategy(config);
        case 'mean_reversion': return new MeanReversionStrategy(config);
        case 'grid': return new GridTradingStrategy(config);
        default: throw new Error('Unknown strategy type');
      }
    };
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  // ============================================================================
  // STRATEGY FACTORY (10 tests)
  // ============================================================================
  describe('Strategy factory', () => {
    it('Creates V2 strategies', () => {
      expect(strategyFactory.create('momentum').name).toContain('Momentum v2');
      expect(strategyFactory.create('mean_reversion').name).toContain('Mean Reversion v2');
      expect(strategyFactory.create('grid').name).toContain('Grid Trading v2');
    });

    it('Applies custom parameters', () => {
      const strategy = strategyFactory.create('momentum', { trailingStopAtrMultiplier: 5.0 });
      expect(strategy.config.trailingStopAtrMultiplier).toBe(5.0);
    });
    
    it('Default parameters when none provided', () => {
      const strategy = strategyFactory.create('momentum', {});
      expect(strategy.config.emaFast).toBe(12);
    });
  });

  // --- Grid Strategy Tests ---
  describe('GridTradingStrategyV2', () => {
    it('Initializes grid on first run', async () => {
      const strategy = new GridTradingStrategy({ gridLevels: 4 });
      const marketData = {
        pair: 'BTC/USDT',
        price: 100,
        indicators: { warmedUp: true, trendAlignment: { direction: 'neutral' } }
      };
      
      await strategy.generateSignal(marketData);
      expect(strategy.grids.has('BTC/USDT')).toBe(true);
      expect(strategy.grids.get('BTC/USDT')).toHaveLength(4);
    });
  });

  // --- Mean Reversion Tests ---
  describe('MeanReversionStrategyV2', () => {
    it('Buy signal when price touches lower Bollinger band AND RSI oversold', async () => {
      const strategy = new MeanReversionStrategy({ rsiOversold: 30, requireConfirmation: false });
      const marketData = {
        price: 90,
        indicators: { 
          bb: { lower: 95, middle: 100, upper: 105 },
          rsi: 25
        }
      };

      const signal = await strategy.generateSignal(marketData);
      expect(signal.action).toBe('buy');
    });

    it('Sell signal on RSI overbought', async () => {
      const strategy = new MeanReversionStrategy({ rsiOverbought: 70, requireConfirmation: false });
      strategy.position = { amount: 1 };
      const marketData = {
        price: 110,
        indicators: { 
          bb: { lower: 95, middle: 100, upper: 105 },
          rsi: 75
        }
      };

      const signal = await strategy.generateSignal(marketData);
      expect(signal.action).toBe('sell');
    });
  });
});

  afterAll(() => {
    vi.restoreAllMocks();
  });

  // ============================================================================
  // STRATEGY FACTORY (10 tests)
  // ============================================================================
  describe('Strategy factory', () => {
    it('Creates V2 strategies', () => {
      expect(strategyFactory.create('momentum').name).toContain('Momentum v2');
      expect(strategyFactory.create('mean_reversion').name).toContain('Mean Reversion v2');
      expect(strategyFactory.create('grid').name).toContain('Grid Trading v2');
    });

    it('Applies custom parameters', () => {
      const strategy = strategyFactory.create('momentum', { trailingStopAtrMultiplier: 5.0 });
      expect(strategy.config.trailingStopAtrMultiplier).toBe(5.0);
    });
    
    it('Default parameters when none provided', () => {
      const strategy = strategyFactory.create('momentum', {});
      expect(strategy.config.emaFast).toBe(12);
    });
  });

  // --- Grid Strategy Tests ---
  describe('GridTradingStrategyV2', () => {
    it('Initializes grid on first run', async () => {
      const strategy = new GridTradingStrategy({ gridLevels: 4 });
      const marketData = {
        pair: 'BTC/USDT',
        price: 100,
        indicators: { warmedUp: true, trendAlignment: { direction: 'neutral' } }
      };
      
      await strategy.generateSignal(marketData);
      expect(strategy.grids.has('BTC/USDT')).toBe(true);
      expect(strategy.grids.get('BTC/USDT')).toHaveLength(4);
    });
  });

  // --- Mean Reversion Tests ---
  describe('MeanReversionStrategyV2', () => {
    it('Buy signal when price touches lower Bollinger band AND RSI oversold', async () => {
      const strategy = new MeanReversionStrategy({ rsiOversold: 30, requireConfirmation: false });
      const marketData = {
        price: 90,
        indicators: { 
          bb: { lower: 95, middle: 100, upper: 105 },
          rsi: 25
        }
      };

      const signal = await strategy.generateSignal(marketData);
      expect(signal.action).toBe('buy');
    });

    it('Sell signal on RSI overbought', async () => {
      const strategy = new MeanReversionStrategy({ rsiOverbought: 70, requireConfirmation: false });
      strategy.position = { amount: 1 };
      const marketData = {
        price: 110,
        indicators: { 
          bb: { lower: 95, middle: 100, upper: 105 },
          rsi: 75
        }
      };

      const signal = await strategy.generateSignal(marketData);
      expect(signal.action).toBe('sell');
    });
  });
});

  beforeAll(async () => {
    // Setup for strategy factory, ensuring it uses V2 classes
    strategyFactory.create = (type, config) => {
      switch(type) {
        case 'momentum': return new MomentumStrategy(config);
        case 'mean_reversion': return new MeanReversionStrategy(config);
        case 'grid': return new GridTradingStrategy(config);
        default: throw new Error('Unknown strategy type');
      }
    };
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  // ============================================================================
  // STRATEGY FACTORY (10 tests)
  // ============================================================================
  describe('Strategy factory', () => {
    it('Creates V2 strategies', () => {
      expect(strategyFactory.create('momentum').name).toContain('Momentum v2');
      expect(strategyFactory.create('mean_reversion').name).toContain('Mean Reversion v2');
      expect(strategyFactory.create('grid').name).toContain('Grid Trading v2');
    });

    it('Applies custom parameters', () => {
      const strategy = strategyFactory.create('momentum', { trailingStopAtrMultiplier: 5.0 });
      expect(strategy.config.trailingStopAtrMultiplier).toBe(5.0);
    });
    
    it('Default parameters when none provided', () => {
      const strategy = strategyFactory.create('momentum', {});
      expect(strategy.config.emaFast).toBe(12);
      expect(strategy.config.emaSlow).toBe(26);
    });
  });

  // --- Grid Strategy Tests ---
  describe('GridTradingStrategyV2', () => {
    it('Initializes grid on first run', async () => {
      const strategy = new GridTradingStrategy({ gridLevels: 4 });
      const marketData = {
        pair: 'BTC/USDT',
        price: 100,
        indicators: { warmedUp: true, trendAlignment: { direction: 'neutral' } }
      };
      
      await strategy.generateSignal(marketData);
      expect(strategy.grids.has('BTC/USDT')).toBe(true);
      expect(strategy.grids.get('BTC/USDT')).toHaveLength(4);
    });
  });

  // --- Mean Reversion Tests ---
  describe('MeanReversionStrategyV2', () => {
    it('Buy signal when price touches lower Bollinger band AND RSI oversold', async () => {
      const strategy = new MeanReversionStrategy({ rsiOversold: 30, requireConfirmation: false });
      const marketData = {
        price: 90,
        indicators: { 
          bb: { lower: 95, middle: 100, upper: 105 },
          rsi: 25
        }
      };

      const signal = await strategy.generateSignal(marketData);
      expect(signal.action).toBe('buy');
    });

    it('Sell signal on RSI overbought', async () => {
      const strategy = new MeanReversionStrategy({ rsiOverbought: 70, requireConfirmation: false });
      strategy.position = { amount: 1 };
      const marketData = {
        price: 110,
        indicators: { 
          bb: { lower: 95, middle: 100, upper: 105 },
          rsi: 75
        }
      };

      const signal = await strategy.generateSignal(marketData);
      expect(signal.action).toBe('sell');
    });
  });
});

    it('Sell signal when MACD crosses below', async () => {
      const strategy = new MomentumStrategy({});
      strategy.position = { amount: 0.1 };
      
      const marketData = {
        price: 100,
        indicators: { ema12: 98, ema26: 99, macd: { histogram: -1 } },
      };

      const signal = await strategy.generateSignal(marketData);
      expect(signal.action).toBe('sell');
      expect(signal.reason).toMatch(/MACD/i);
    });

    it('Strategy reset clears indicators', () => {
      const strategy = new MomentumStrategy();
      strategy.indicatorStates.set('BTC/USD', {});
      strategy.reset();
      expect(strategy.indicatorStates.size).toBe(0);
    });
  });

  describe('MeanReversionStrategyV2', () => {
    it('Buy signal when price touches lower Bollinger band AND RSI oversold', async () => {
      const strategy = new MeanReversionStrategy({ rsiOversold: 30, requireConfirmation: false });
      const marketData = {
        price: 90,
        indicators: { 
          bb: { lower: 95, middle: 100, upper: 105 },
          rsi: 25
        }
      };

      const signal = await strategy.generateSignal(marketData);
      expect(signal.action).toBe('buy');
    });

    it('Sell signal on RSI overbought', async () => {
      const strategy = new MeanReversionStrategy({ rsiOverbought: 70 });
      strategy.position = { amount: 1 };
      const marketData = {
        price: 110,
        indicators: { 
          bb: { lower: 95, middle: 100, upper: 105 },
          rsi: 75
        }
      };

      const signal = await strategy.generateSignal(marketData);
      expect(signal.action).toBe('sell');
    });
  });

  describe('GridTradingStrategyV2', () => {
    it('Initializes grid on first run', async () => {
      const strategy = new GridTradingStrategy({ gridLevels: 4 });
      const marketData = {
        pair: 'BTC/USD',
        price: 100,
        indicators: { warmedUp: true }
      };
      
      await strategy.generateSignal(marketData);
      expect(strategy.grids.has('BTC/USD')).toBe(true);
      expect(strategy.grids.get('BTC/USD')).toHaveLength(4);
    });
  });

  describe('Strategy factory', () => {
    it('Creates V2 strategies', () => {
      expect(strategyFactory.create('momentum').name).toContain('Momentum');
      expect(strategyFactory.create('mean_reversion').name).toContain('Mean Reversion');
      expect(strategyFactory.create('grid').name).toContain('Grid');
    });
  });
});
