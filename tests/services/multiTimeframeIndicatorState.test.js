const MultiTimeframeIndicatorState = require('../../src/services/MultiTimeframeIndicatorState');

describe('MultiTimeframeIndicatorState', () => {
  let mtis;

  beforeEach(() => {
    mtis = new MultiTimeframeIndicatorState(['15m', '1h']);
  });

  describe('getIndicatorValue', () => {
    it('should return null for an unknown timeframe', () => {
      const value = mtis.getIndicatorValue('unknown_tf', 'rsi');
      expect(value).toBeNull();
    });

    it('should return null if the indicator is not available in the snapshot', () => {
      const value = mtis.getIndicatorValue('15m', 'non_existent_indicator');
      expect(value).toBeNull();
    });

    it('should return null/undefined without throwing when requesting an unpopulated timeframe', () => {
      // We haven't pushed any candle data yet, so the timeframe is unpopulated
      const value = mtis.getIndicatorValue('1h', 'rsi');
      expect(value).toBeFalsy(); // It should return null or undefined, without throwing an error
    });

    it('should return the correct indicator value when it exists', () => {
      // Warm up the indicator state so that indicators have values
      for (let i = 0; i < 50; i++) {
        mtis.update({
          timestamp: 1000000 + i * 900000,
          open: 100,
          high: 105,
          low: 95,
          close: 100 + i, // creating a trend
          volume: 1000,
        });
      }

      const rsi = mtis.getIndicatorValue('15m', 'rsi');
      expect(rsi).not.toBeNull();
      expect(typeof rsi).toBe('number');

      const warmedUp = mtis.getIndicatorValue('15m', 'warmedUp');
      expect(warmedUp).toBe(true);
    });
  });
});
