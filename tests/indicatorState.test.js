// vitest globals (describe, it, expect) are injected via vitest.config.js globals: true
const BacktestEngine = require('../src/services/backtestEngine');

function createIndicatorRecorder() {
  const snapshots = [];
  const strategy = {
    name: 'IndicatorRecorder',
    generateSignal: async (marketData) => {
      snapshots.push({ ...marketData.indicators, price: marketData.price });
      return { action: 'hold', confidence: 0 };
    },
    updateParams: () => {},
    reset: () => {},
  };
  return { strategy, snapshots };
}

function makeCandles(closes) {
  return closes.map((close, i) => ({
    timestamp: 1000000 + i * 3600000,
    open: close,
    high: close * 1.01,
    low: close * 0.99,
    close,
    volume: 100,
  }));
}

describe('IndicatorState (via BacktestEngine)', () => {
  describe('EMA', () => {
    it('should compute EMA correctly for constant price', async () => {
      const candles = makeCandles(Array(60).fill(100));
      const { strategy, snapshots } = createIndicatorRecorder();
      const engine = new BacktestEngine({ initialBalance: 10000, warmUpPeriod: 50 });
      await engine.run(strategy, candles, { enableLogging: false });

      const last = snapshots[snapshots.length - 1];
      expect(last.ema12).toBeCloseTo(100, 5);
      expect(last.ema26).toBeCloseTo(100, 5);
    });

    it('should track a rising price trend (EMA12 > EMA26)', async () => {
      const closes = Array.from({ length: 60 }, (_, i) => 100 + i);
      const candles = makeCandles(closes);
      const { strategy, snapshots } = createIndicatorRecorder();
      const engine = new BacktestEngine({ initialBalance: 10000, warmUpPeriod: 50 });
      await engine.run(strategy, candles, { enableLogging: false });

      const last = snapshots[snapshots.length - 1];
      expect(last.ema12).toBeGreaterThan(last.ema26);
      expect(last.ema12).toBeLessThan(159);
      expect(last.ema12).toBeGreaterThan(100);
    });
  });

  describe('RSI (Wilder)', () => {
    it('should be near 50 when gains roughly equal losses', async () => {
      const closes = Array.from({ length: 60 }, (_, i) => 100 + (i % 2));
      const candles = makeCandles(closes);
      const { strategy, snapshots } = createIndicatorRecorder();
      const engine = new BacktestEngine({ initialBalance: 10000, warmUpPeriod: 50 });
      await engine.run(strategy, candles, { enableLogging: false });

      const last = snapshots[snapshots.length - 1];
      // Alternating 100/101 gives slightly asymmetric returns, so RSI ~52
      expect(last.rsi).toBeGreaterThan(45);
      expect(last.rsi).toBeLessThan(55);
    });

    it('should be >90 in pure uptrend', async () => {
      const closes = Array.from({ length: 60 }, (_, i) => 100 + i * 2);
      const candles = makeCandles(closes);
      const { strategy, snapshots } = createIndicatorRecorder();
      const engine = new BacktestEngine({ initialBalance: 10000, warmUpPeriod: 50 });
      await engine.run(strategy, candles, { enableLogging: false });

      const last = snapshots[snapshots.length - 1];
      expect(last.rsi).toBeGreaterThan(90);
    });

    it('should be <10 in pure downtrend', async () => {
      const closes = Array.from({ length: 60 }, (_, i) => 200 - i);
      const candles = makeCandles(closes);
      const { strategy, snapshots } = createIndicatorRecorder();
      const engine = new BacktestEngine({ initialBalance: 10000, warmUpPeriod: 50 });
      await engine.run(strategy, candles, { enableLogging: false });

      const last = snapshots[snapshots.length - 1];
      expect(last.rsi).toBeLessThan(10);
    });
  });

  describe('MACD', () => {
    it('should be ~0 for flat prices', async () => {
      const candles = makeCandles(Array(60).fill(100));
      const { strategy, snapshots } = createIndicatorRecorder();
      const engine = new BacktestEngine({ initialBalance: 10000, warmUpPeriod: 50 });
      await engine.run(strategy, candles, { enableLogging: false });

      const last = snapshots[snapshots.length - 1];
      expect(last.macd).not.toBeNull();
      expect(last.macd.line).toBeCloseTo(0, 5);
      expect(last.macd.signal).toBeCloseTo(0, 3);
      expect(last.macd.histogram).toBeCloseTo(0, 3);
    });

    it('should be positive in uptrend', async () => {
      const closes = Array.from({ length: 80 }, (_, i) => 100 + i);
      const candles = makeCandles(closes);
      const { strategy, snapshots } = createIndicatorRecorder();
      const engine = new BacktestEngine({ initialBalance: 10000, warmUpPeriod: 50 });
      await engine.run(strategy, candles, { enableLogging: false });

      const last = snapshots[snapshots.length - 1];
      expect(last.macd.line).toBeGreaterThan(0);
      expect(last.macd.signal).toBeGreaterThan(0);
    });

    it('should NOT use fake signalLine = macdLine * 0.8', async () => {
      const closes = Array.from({ length: 80 }, (_, i) => 100 + i);
      const candles = makeCandles(closes);
      const { strategy, snapshots } = createIndicatorRecorder();
      const engine = new BacktestEngine({ initialBalance: 10000, warmUpPeriod: 50 });
      await engine.run(strategy, candles, { enableLogging: false });

      const last = snapshots[snapshots.length - 1];
      if (last.macd.line !== 0) {
        const ratio = last.macd.histogram / last.macd.line;
        expect(ratio).not.toBeCloseTo(0.2, 2);
      }
    });
  });

  describe('Bollinger Bands', () => {
    it('should collapse for constant prices', async () => {
      const candles = makeCandles(Array(60).fill(100));
      const { strategy, snapshots } = createIndicatorRecorder();
      const engine = new BacktestEngine({ initialBalance: 10000, warmUpPeriod: 50 });
      await engine.run(strategy, candles, { enableLogging: false });

      const last = snapshots[snapshots.length - 1];
      expect(last.bb).not.toBeNull();
      expect(last.bb.middle).toBeCloseTo(100, 5);
      expect(last.bb.upper).toBeCloseTo(100, 5);
      expect(last.bb.lower).toBeCloseTo(100, 5);
    });

    it('should widen with volatile prices', async () => {
      const closes = Array.from({ length: 60 }, (_, i) => (i % 2 === 0) ? 90 : 110);
      const candles = makeCandles(closes);
      const { strategy, snapshots } = createIndicatorRecorder();
      const engine = new BacktestEngine({ initialBalance: 10000, warmUpPeriod: 50 });
      await engine.run(strategy, candles, { enableLogging: false });

      const last = snapshots[snapshots.length - 1];
      expect(last.bb.middle).toBeCloseTo(100, 0);
      expect(last.bb.upper).toBeGreaterThan(110);
      expect(last.bb.lower).toBeLessThan(90);
    });
  });

  describe('Warm-up', () => {
    it('should skip signals during warm-up period', async () => {
      const candles = makeCandles(Array(10).fill(100));
      const { strategy, snapshots } = createIndicatorRecorder();
      const engine = new BacktestEngine({ initialBalance: 10000, warmUpPeriod: 50 });
      await engine.run(strategy, candles, { enableLogging: false });
      expect(snapshots.length).toBe(0);
    });

    it('should emit warmedUp=true after warm-up', async () => {
      const candles = makeCandles(Array(60).fill(100));
      const { strategy, snapshots } = createIndicatorRecorder();
      const engine = new BacktestEngine({ initialBalance: 10000, warmUpPeriod: 50 });
      await engine.run(strategy, candles, { enableLogging: false });

      expect(snapshots.length).toBe(10);
      for (const snap of snapshots) {
        expect(snap.warmedUp).toBe(true);
      }
    });
  });
});
