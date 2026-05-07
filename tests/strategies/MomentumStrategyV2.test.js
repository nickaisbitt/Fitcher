// vitest globals (describe, it, expect, vi) are injected via vitest.config.js globals: true

vi.mock('../../src/utils/logger', () => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

const MomentumStrategyV2 = require('../../src/strategies/MomentumStrategyV2');
const MultiTimeframeIndicatorState = require('../../src/services/MultiTimeframeIndicatorState');
const { createMockMarketData, createMockCandle } = require('../helpers/fixtures');

describe('MomentumStrategyV2', () => {
  let strategy;

  beforeEach(() => {
    strategy = new MomentumStrategyV2({
      primaryTimeframe: '1h',
      timeframes: ['15m', '1h', '4h', '1d']
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Constructor and Config', () => {
    it('should be defined with default settings', () => {
      expect(strategy).toBeDefined();
      expect(strategy.name).toBe('Momentum v2');
      expect(strategy.config.primaryTimeframe).toBe('1h');
    });

    it('should accept custom config options', () => {
      const customStrategy = new MomentumStrategyV2({
        emaFast: 10,
        emaSlow: 20,
        requireRsiFilter: false
      });
      expect(customStrategy.config.emaFast).toBe(10);
      expect(customStrategy.config.emaSlow).toBe(20);
      expect(customStrategy.config.requireRsiFilter).toBe(false);
    });
  });

  describe('initializePair', () => {
    it('should initialize indicator state for a given pair', () => {
      const state = strategy.initializePair('BTC/USD');
      expect(state).toBeInstanceOf(MultiTimeframeIndicatorState);
      expect(strategy.indicatorStates.has('BTC/USD')).toBe(true);

      // Should return the same state on subsequent calls
      const stateAgain = strategy.initializePair('BTC/USD');
      expect(stateAgain).toBe(state);
    });
  });

  describe('update', () => {
    it('should update indicator state with new candle', () => {
      const mockState = { update: vi.fn() };
      strategy.indicatorStates.set('BTC/USD', mockState);

      const candle = createMockCandle({ pair: 'BTC/USD' });
      strategy.update(candle, 'BTC/USD');

      expect(mockState.update).toHaveBeenCalledWith(candle);
    });
  });

  describe('generateSignal (via analyze)', () => {
    it('should return hold if indicators are warming up', async () => {
      const marketData = {
        pair: 'BTC/USD',
        price: 50000,
        volume: 100,
        timestamp: Date.now()
      };

      const signal = await strategy.generateSignal(marketData);
      expect(signal.action).toBe('hold');
      expect(signal.reason).toContain('warming up');
    });

    it('should generate a buy signal when bullish conditions are met', async () => {
      // Create a snapshot that meets all buy conditions
      const mockIndicators = {
        warmedUp: true,
        ema12: 50500, // fast > slow
        ema26: 50000,
        rsi: 60,      // > 50
        macd: { histogram: 10 }, // positive
      };

      const marketData = {
        pair: 'BTC/USD',
        price: 50500,
        volume: 200,
        timestamp: Date.now(),
      };

      // Mock the initializePair to return our own mock state
      const mockState = {
        getSnapshot: () => ({
          '1h': mockIndicators,
          '4h': { ...mockIndicators, ema12: 52000, ema26: 49000 }, // spread > 0.01 for strong bullish
          '1d': { ...mockIndicators, ema12: 53000, ema26: 48000 }, // spread > 0.01 for strong bullish
          overallWarmedUp: true,
          trendAlignment: 'uptrend',
          rsi: 60
        }),
        getATR: () => 1000,
        getTrendStrength: () => 25, // > 20 threshold
        getVolumeMovingAverage: () => 100,
        getCandles: () => [] // Mock getCandles returning an empty array to avoid TypeError
      };

      vi.spyOn(strategy, 'initializePair').mockReturnValue(mockState);

      const signal = await strategy.generateSignal(marketData);

      expect(signal.action).toBe('buy');
      expect(signal.confidence).toBeGreaterThan(0);
      expect(signal.orderType).toBeDefined();
      expect(signal.amount).toBeGreaterThan(0);
      expect(signal.stopLoss).toBeLessThan(marketData.price);
      expect(signal.takeProfit).toBeGreaterThan(marketData.price);
    });

    it('should generate a sell signal if in position and conditions become bearish', async () => {
      // Mock existing position
      strategy.position = {
        amount: 1,
        entryPrice: 40000,
        trailingStop: 35000,
        stopLoss: 30000
      };

      const mockIndicators = {
        warmedUp: true,
        ema12: 49000, // fast < slow
        ema26: 50000,
        rsi: 40,      // < 50
        macd: { histogram: -10 }, // negative
      };

      const marketData = {
        pair: 'BTC/USD',
        price: 49000,
        volume: 200,
        timestamp: Date.now(),
        indicators: mockIndicators
      };

      const mockState = {
        getSnapshot: () => ({
          '1h': mockIndicators,
          '4h': { ...mockIndicators, ema12: 49000, ema26: 51000 },
          '1d': { ...mockIndicators, ema12: 49000, ema26: 52000 },
          overallWarmedUp: true,
          trendAlignment: 'downtrend'
        }),
        getATR: () => 1000,
        getTrendStrength: () => 25,
        getVolumeMovingAverage: () => 100,
        getCandles: () => []
      };

      vi.spyOn(strategy, 'initializePair').mockReturnValue(mockState);

      const signal = await strategy.generateSignal(marketData);

      expect(signal.action).toBe('sell');
      expect(signal.reason).toContain('MACD bearish reversal');
    });

    it('should sell if stop loss is hit', async () => {
      strategy.position = {
        amount: 1,
        entryPrice: 50000,
        trailingStop: 40000,
        stopLoss: 45000
      };

      const marketData = {
        pair: 'BTC/USD',
        price: 44000, // Below stop loss
        volume: 200,
        timestamp: Date.now(),
        indicators: {
          warmedUp: true,
          ema12: 50000,
          ema26: 49000,
          rsi: 60,
          macd: { histogram: 10 },
        }
      };

      const signal = await strategy.generateSignal(marketData);
      expect(signal.action).toBe('sell');
      expect(signal.reason).toContain('Stop loss hit');
    });

    it('should hold if conditions are mixed', async () => {
      const mockIndicators = {
        warmedUp: true,
        ema12: 50500, // bullish
        ema26: 50000,
        rsi: 40,      // bearish (filters buy)
        macd: { histogram: 10 },
      };

      const marketData = {
        pair: 'BTC/USD',
        price: 50500,
        volume: 200,
        timestamp: Date.now(),
        indicators: mockIndicators
      };

      const mockState = {
        getSnapshot: () => ({
          '1h': mockIndicators,
          overallWarmedUp: true,
          trendAlignment: 'uptrend'
        }),
        getATR: () => 1000,
        getTrendStrength: () => 25,
        getVolumeMovingAverage: () => 100,
        getCandles: () => []
      };

      vi.spyOn(strategy, 'initializePair').mockReturnValue(mockState);

      const signal = await strategy.generateSignal(marketData);
      expect(signal.action).toBe('hold');
      expect(signal.reason).toContain('Confidence');
    });
  });

  describe('Helper methods', () => {
    it('calculateEMASignal computes correctly', () => {
      const bullishResult = strategy.calculateEMASignal({ ema12: 110, ema26: 100 });
      expect(bullishResult.bullish).toBe(true);
      expect(bullishResult.bearish).toBe(false);

      const bearishResult = strategy.calculateEMASignal({ ema12: 90, ema26: 100 });
      expect(bearishResult.bullish).toBe(false);
      expect(bearishResult.bearish).toBe(true);

      const invalidResult = strategy.calculateEMASignal({ ema12: null, ema26: null });
      expect(invalidResult.bullish).toBe(false);
    });

    it('calculateMACDSignal computes correctly', () => {
      const bullishResult = strategy.calculateMACDSignal({ macd: { histogram: 5 } });
      expect(bullishResult.bullish).toBe(true);
      expect(bullishResult.bearish).toBe(false);

      const bearishResult = strategy.calculateMACDSignal({ macd: { histogram: -5 } });
      expect(bearishResult.bullish).toBe(false);
      expect(bearishResult.bearish).toBe(true);
    });

    it('combineSignals computes correctly', () => {
      const emaSignal = { bullish: true, bearish: false, strength: 10, spread: 0.05 };
      const macdSignal = { bullish: true, bearish: false, strength: 5, histogram: 2 };
      const volumeSignal = { bullish: true, bearish: false, strength: 5, volumeRatio: 1.5 };
      const alignment = { bullishScore: 0.8, bearishScore: 0.2, direction: 'uptrend' };

      const result = strategy.combineSignals(emaSignal, macdSignal, volumeSignal, alignment);
      expect(result.bullish).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('calculateDynamicStops returns percentage stops when no ATR', () => {
      const stops = strategy.calculateDynamicStops(100, 0);
      expect(stops.stopLoss).toBeDefined();
      expect(stops.takeProfit).toBeDefined();
    });

    it('calculateDynamicStops returns ATR-based stops', () => {
      const stops = strategy.calculateDynamicStops(100, 10);
      expect(stops.stopLoss).toBe(100 - (10 * strategy.config.stopLossAtrMultiplier));
      expect(stops.takeProfit).toBe(100 + (10 * strategy.config.takeProfitAtrMultiplier));
    });

    it('selectOrderType returns market in strong trends with high confidence', () => {
      const type = strategy.selectOrderType({ direction: 'strong_uptrend' }, 0.9);
      expect(type).toBe('market');

      const typeLimit = strategy.selectOrderType({ direction: 'uptrend' }, 0.9);
      expect(typeLimit).toBe('limit');
    });

    it('analyzeTrendAlignment computes correctly', () => {
      const snapshot = {
        '1h': { warmedUp: true, ema12: 105, ema26: 100 }, // bullish
        '4h': { warmedUp: true, ema12: 110, ema26: 100 }, // strong bullish
        '1d': { warmedUp: true, ema12: 95, ema26: 100 }, // bearish
      };

      const result = strategy.analyzeTrendAlignment(snapshot);
      expect(result.score).toBeGreaterThan(0);
      expect(result.bullishScore).toBeGreaterThan(0);
    });
  });
});
