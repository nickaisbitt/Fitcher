// vitest globals (describe, it, expect, vi, beforeEach, afterEach) injected via vitest.config.js
const MomentumStrategy = require('../../src/strategies/MomentumStrategyV2');
const MeanReversionStrategy = require('../../src/strategies/MeanReversionStrategyV2');
const GridTradingStrategy = require('../../src/strategies/GridTradingStrategyV2');
const strategyFactory = require('../../src/strategies/strategyFactory');
const BacktestEngine = require('../../src/services/backtestEngine');
const { createCandleSeries } = require('../helpers/fixtures');

vi.mock('../../src/utils/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

async function collectSignals(strategy, candles, warmUp = 50) {
  const engine = new BacktestEngine({ warmUpPeriod: warmUp });
  const signals = [];
  const wrapper = {
    name: strategy.name,
    update: (c, p) => strategy.update(c, p),
    generateSignal: async (data) => {
      const s = await strategy.generateSignal(data);
      if (s) signals.push(s);
      return s;
    }
  };
  await engine.run(wrapper, candles, { enableLogging: false });
  return signals;
}

function makeCandles(closes) {
  return closes.map((close, i) => ({
    timestamp: 1000000 + i * 3600000,
    open: close,
    high: close * 1.01,
    low: close * 0.99,
    close,
    volume: 1000,
  }));
}

describe('Strategy v2 edge cases', () => {
  describe('MomentumStrategyV2', () => {
    it('Sell signal on trailing stop hit', async () => {
      const strategy = new MomentumStrategy({ trailingStop: 0.03 });
      strategy.position = { amount: 0.1, trailingStop: 97 };
      strategy.highestPrice = 100;

      const marketData = {
        price: 96,
        indicators: { ema12: 98, ema26: 99, macd: { histogram: -1 } },
      };

      const signal = await strategy.generateSignal(marketData);
      expect(signal.action).toBe('sell');
      expect(signal.reason).toMatch(/trailing stop/i);
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
