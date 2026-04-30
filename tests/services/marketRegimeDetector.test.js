const MarketRegimeDetector = require('../../src/services/MarketRegimeDetector');

describe('MarketRegimeDetector', () => {
  let detector;

  beforeEach(() => {
    detector = new MarketRegimeDetector();
  });

  describe('constructor', () => {
    it('should initialize with default config', () => {
      expect(detector.config.adxThreshold).toBe(25);
      expect(detector.config.volatilityThreshold).toBe(0.03);
      expect(detector.trendState).toBeInstanceOf(Map);
    });

    it('should initialize with custom config', () => {
      const customDetector = new MarketRegimeDetector({
        adxThreshold: 30,
        volatilityThreshold: 0.05,
        otherParam: 'test'
      });
      expect(customDetector.config.adxThreshold).toBe(30);
      expect(customDetector.config.volatilityThreshold).toBe(0.05);
      expect(customDetector.config.otherParam).toBe('test');
    });
  });

  describe('approximateADX', () => {
    it('should return 0 if indicators are missing ema12 or ema26', () => {
      expect(detector.approximateADX({})).toBe(0);
      expect(detector.approximateADX({ ema12: 100 })).toBe(0);
      expect(detector.approximateADX({ ema26: 100 })).toBe(0);
    });

    it('should calculate approximate ADX based on EMA spread', () => {
      const indicators = { ema12: 110, ema26: 100 };
      // spread = Math.abs(110 - 100) / 100 = 0.1
      // ADX = 0.1 * 500 = 50
      expect(detector.approximateADX(indicators)).toBe(50);
    });

    it('should calculate approximate ADX correctly for downtrend', () => {
      const indicators = { ema12: 90, ema26: 100 };
      // spread = Math.abs(90 - 100) / 100 = 0.1
      // ADX = 0.1 * 500 = 50
      expect(detector.approximateADX(indicators)).toBe(50);
    });
  });

  describe('analyzeTrendAlignment', () => {
    it('should ignore timeframes without warmedUp indicators', () => {
      const snapshot = {
        '1h': { warmedUp: false, ema12: 110, ema26: 100 },
        '15m': { ema12: 110, ema26: 100 } // missing warmedUp
      };
      const result = detector.analyzeTrendAlignment(snapshot);
      expect(result).toEqual({ score: 0, direction: 'neutral' });
      expect(detector.trendState.get('global')).toEqual({ score: 0, direction: 'neutral' });
    });

    it('should detect uptrend (regular bullish)', () => {
      const snapshot = {
        '15m': { warmedUp: true, ema12: 100.5, ema26: 100 } // Spread = 0.5% (regular bullish)
      };
      const result = detector.analyzeTrendAlignment(snapshot);
      // bullishCount = 1, strongBullish = 0. Score = 1
      expect(result).toEqual({ score: 1, direction: 'uptrend' });
    });

    it('should detect strong uptrend (strong bullish)', () => {
      const snapshot = {
        '15m': { warmedUp: true, ema12: 102, ema26: 100 }, // Spread = 2% (strong bullish -> 2 pts)
        '1d': { warmedUp: true, ema12: 100.5, ema26: 100 } // Spread = 0.5% (regular bullish -> 1 pt)
      };
      const result = detector.analyzeTrendAlignment(snapshot);
      // Score = 2 + 1 = 3 -> 'strong_uptrend'
      expect(result).toEqual({ score: 3, direction: 'strong_uptrend' });
    });

    it('should detect downtrend (regular bearish)', () => {
      const snapshot = {
        '15m': { warmedUp: true, ema12: 99.5, ema26: 100 } // Spread = 0.5% (regular bearish)
      };
      const result = detector.analyzeTrendAlignment(snapshot);
      // bearishCount = 1. Score = -1
      expect(result).toEqual({ score: -1, direction: 'downtrend' });
    });

    it('should detect strong downtrend (strong bearish)', () => {
      const snapshot = {
        '1d': { warmedUp: true, ema12: 98, ema26: 100 }, // Spread = 2% (strong bearish -> 2 pts)
        '15m': { warmedUp: true, ema12: 99.5, ema26: 100 } // Spread = 0.5% (regular bearish -> 1 pt)
      };
      const result = detector.analyzeTrendAlignment(snapshot);
      // Score = -3 -> 'strong_downtrend'
      expect(result).toEqual({ score: -3, direction: 'strong_downtrend' });
    });

    it('should aggregate conflicting timeframes (neutral)', () => {
      const snapshot = {
        '15m': { warmedUp: true, ema12: 102, ema26: 100 }, // strong bullish = +2
        '1d': { warmedUp: true, ema12: 98, ema26: 100 }   // strong bearish = -2
      };
      const result = detector.analyzeTrendAlignment(snapshot);
      // Score = 0
      expect(result).toEqual({ score: 0, direction: 'neutral' });
    });
  });
  describe('detect', () => {
    it('should return unknown if primary timeframe is missing or not warmedUp', () => {
      expect(detector.detect({})).toBe('unknown');
      expect(detector.detect({ '1h': { warmedUp: false } })).toBe('unknown');
    });

    it('should detect volatile regime based on ATR', () => {
      const snapshot = {
        '1h': {
          warmedUp: true,
          close: 100,
          atr: 5, // Volatility = 5 / 100 = 0.05 (threshold is 0.03)
          ema12: 100,
          ema26: 100
        }
      };
      expect(detector.detect(snapshot)).toBe('volatile');
    });

    it('should detect volatile regime based on Bollinger Bands if ATR is missing', () => {
      const snapshot = {
        '1h': {
          warmedUp: true,
          close: 100,
          bb: { upper: 120, lower: 80 }, // ATR approx = (120 - 80) / 4 = 10. Volatility = 10 / 100 = 0.1
          ema12: 100,
          ema26: 100
        }
      };
      expect(detector.detect(snapshot)).toBe('volatile');
    });

    it('should detect trending_up regime', () => {
      const snapshot = {
        '1h': {
          warmedUp: true,
          close: 100,
          atr: 1, // Volatility = 0.01 (not volatile)
          ema12: 110,
          ema26: 100 // Spread = 0.1. ADX = 50.
        },
        '1d': {
          warmedUp: true,
          ema12: 110,
          ema26: 100 // Score = 2 -> uptrend.
        }
      };
      expect(detector.detect(snapshot)).toBe('trending_up');
    });

    it('should detect trending_down regime', () => {
      const snapshot = {
        '1h': {
          warmedUp: true,
          close: 100,
          atr: 1, // Volatility = 0.01 (not volatile)
          ema12: 90,
          ema26: 100 // Spread = 0.1. ADX = 50.
        },
        '1d': {
          warmedUp: true,
          ema12: 90,
          ema26: 100 // Score = -2 -> downtrend.
        }
      };
      expect(detector.detect(snapshot)).toBe('trending_down');
    });

    it('should detect ranging regime when ADX is low', () => {
      const snapshot = {
        '1h': {
          warmedUp: true,
          close: 100,
          atr: 1, // Volatility = 0.01 (not volatile)
          ema12: 101,
          ema26: 100 // Spread = 0.01. ADX = 5 (below threshold 25)
        }
      };
      expect(detector.detect(snapshot)).toBe('ranging');
    });
  });

  describe('getWeights', () => {
    it('should return correct weights for trending_up', () => {
      expect(detector.getWeights('trending_up')).toEqual({ momentum: 1.5, meanReversion: 0.5, grid: 0.2 });
    });

    it('should return correct weights for trending_down', () => {
      expect(detector.getWeights('trending_down')).toEqual({ momentum: 1.5, meanReversion: 0.5, grid: 0.2 });
    });

    it('should return correct weights for ranging', () => {
      expect(detector.getWeights('ranging')).toEqual({ momentum: 0.3, meanReversion: 1.2, grid: 1.5 });
    });

    it('should return correct weights for volatile', () => {
      expect(detector.getWeights('volatile')).toEqual({ momentum: 0.5, meanReversion: 0.5, grid: 0.5 });
    });

    it('should return correct weights for default/unknown regime', () => {
      expect(detector.getWeights('unknown')).toEqual({ momentum: 1.0, meanReversion: 1.0, grid: 1.0 });
      expect(detector.getWeights('random')).toEqual({ momentum: 1.0, meanReversion: 1.0, grid: 1.0 });
    });
  });
});
