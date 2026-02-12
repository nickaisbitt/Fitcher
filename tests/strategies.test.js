// vitest globals (describe, it, expect, beforeEach) are injected via vitest.config.js globals: true
const MomentumStrategy = require('../src/strategies/momentumStrategy');
const MeanReversionStrategy = require('../src/strategies/meanReversionStrategy');
const GridTradingStrategy = require('../src/strategies/gridTradingStrategy');
const BacktestEngine = require('../src/services/backtestEngine');

function makeCandles(closes) {
  return closes.map((close, i) => ({
    timestamp: 1000000 + i * 3600000,
    open: close, high: close * 1.01, low: close * 0.99, close, volume: 100,
  }));
}

describe('MomentumStrategy', () => {
  let strategy;

  beforeEach(() => {
    strategy = new MomentumStrategy({ minTrendStrength: 0.2 });
  });

  it('should hold when indicators not warmed up', async () => {
    const signal = await strategy.generateSignal({
      price: 100,
      indicators: { ema12: null, ema26: null, macd: null, warmedUp: false },
      recentCandles: [],
    });
    expect(signal.action).toBe('hold');
  });

  it('should hold when MACD signal still warming up', async () => {
    const signal = await strategy.generateSignal({
      price: 100,
      indicators: {
        ema12: 101, ema26: 100,
        macd: { line: 1, signal: null, histogram: null },
        warmedUp: true,
      },
      recentCandles: Array(20).fill({ close: 100 }),
    });
    expect(signal.action).toBe('hold');
    expect(signal.reason).toContain('warming up');
  });

  it('should buy on bullish EMA cross + positive MACD', async () => {
    const recentCandles = Array.from({ length: 20 }, (_, i) => ({ close: 90 + i * 0.5 }));

    const signal = await strategy.generateSignal({
      price: 105,
      indicators: {
        ema12: 104, ema26: 100,
        macd: { line: 4, signal: 2, histogram: 2 },
        rsi: 60, warmedUp: true,
      },
      recentCandles,
    });

    expect(signal.action).toBe('buy');
    expect(signal.confidence).toBeGreaterThan(0.5);
    expect(signal.amount).toBeGreaterThan(0);
  });

  it('should NOT sell when not holding (spot-only)', async () => {
    const recentCandles = Array.from({ length: 20 }, (_, i) => ({ close: 110 - i * 0.5 }));

    const signal = await strategy.generateSignal({
      price: 95,
      indicators: {
        ema12: 96, ema26: 100,
        macd: { line: -4, signal: -2, histogram: -2 },
        rsi: 35, warmedUp: true,
      },
      recentCandles,
    });

    expect(signal.action).toBe('hold');
  });

  it('should sell on trailing stop when holding', async () => {
    const upCandles = Array.from({ length: 20 }, (_, i) => ({ close: 90 + i * 0.5 }));
    await strategy.generateSignal({
      price: 105,
      indicators: { ema12: 104, ema26: 100, macd: { line: 4, signal: 2, histogram: 2 }, warmedUp: true },
      recentCandles: upCandles,
    });
    expect(strategy.position).not.toBeNull();

    const sell = await strategy.generateSignal({
      price: 101,
      indicators: { ema12: 102, ema26: 103, macd: { line: -1, signal: 0, histogram: -1 }, warmedUp: true },
      recentCandles: upCandles,
    });

    expect(sell.action).toBe('sell');
    expect(sell.reason).toContain('Trailing stop');
  });

  it('should reset state on updateParams', () => {
    strategy.position = { side: 'long', amount: 1 };
    strategy.highestPrice = 200;
    strategy.updateParams({ positionSize: 0.2 });
    expect(strategy.position).toBeNull();
    expect(strategy.highestPrice).toBe(0);
  });
});

describe('MeanReversionStrategy', () => {
  let strategy;

  beforeEach(() => {
    strategy = new MeanReversionStrategy();
  });

  it('should hold when indicators not available', async () => {
    const signal = await strategy.generateSignal({
      price: 100,
      indicators: { bb: null, rsi: null },
    });
    expect(signal.action).toBe('hold');
  });

  it('should buy when oversold', async () => {
    const signal = await strategy.generateSignal({
      price: 85,
      indicators: { bb: { upper: 110, middle: 100, lower: 90 }, rsi: 25, warmedUp: true },
    });
    expect(signal.action).toBe('buy');
    expect(signal.confidence).toBeGreaterThan(0.5);
  });

  it('should NOT short when overbought without position (spot-only)', async () => {
    const signal = await strategy.generateSignal({
      price: 115,
      indicators: { bb: { upper: 110, middle: 100, lower: 90 }, rsi: 80, warmedUp: true },
    });
    expect(signal.action).toBe('hold');
  });

  it('should sell at mean reversion target', async () => {
    await strategy.generateSignal({
      price: 85,
      indicators: { bb: { upper: 110, middle: 100, lower: 90 }, rsi: 25, warmedUp: true },
    });
    expect(strategy.position).not.toBeNull();

    const exit = await strategy.generateSignal({
      price: 100,
      indicators: { bb: { upper: 110, middle: 100, lower: 90 }, rsi: 50, warmedUp: true },
    });
    expect(exit.action).toBe('sell');
    expect(exit.reason).toContain('Mean reversion');
  });

  it('should sell on stop loss', async () => {
    await strategy.generateSignal({
      price: 85,
      indicators: { bb: { upper: 110, middle: 100, lower: 90 }, rsi: 25, warmedUp: true },
    });

    const exit = await strategy.generateSignal({
      price: 82,
      indicators: { bb: { upper: 110, middle: 100, lower: 90 }, rsi: 20, warmedUp: true },
    });
    expect(exit.action).toBe('sell');
    expect(exit.reason).toContain('Stop loss');
  });

  it('should sell on overbought exit when holding (takeProfitAtMean=false)', async () => {
    // Use a strategy with takeProfitAtMean disabled so overbought check is reached
    const noTPstrategy = new MeanReversionStrategy({ takeProfitAtMean: false });
    await noTPstrategy.generateSignal({
      price: 85,
      indicators: { bb: { upper: 110, middle: 100, lower: 90 }, rsi: 25, warmedUp: true },
    });
    expect(noTPstrategy.position).not.toBeNull();

    const exit = await noTPstrategy.generateSignal({
      price: 115,
      indicators: { bb: { upper: 110, middle: 100, lower: 90 }, rsi: 80, warmedUp: true },
    });
    expect(exit.action).toBe('sell');
    expect(exit.reason).toContain('Overbought');
  });
});

describe('GridTradingStrategy', () => {
  let strategy;

  beforeEach(() => {
    strategy = new GridTradingStrategy({ gridLevels: 10, gridSpacing: 1 });
  });

  it('should initialize grid on first candle', async () => {
    await strategy.generateSignal({ price: 100 });
    expect(strategy.centerPrice).toBe(100);
    expect(strategy.grids.length).toBeGreaterThan(0);
  });

  it('should reset on updateParams', () => {
    strategy.centerPrice = 100;
    strategy.grids = [{ level: 1 }];
    strategy.updateParams({ gridSpacing: 2 });
    expect(strategy.grids).toEqual([]);
    expect(strategy.centerPrice).toBeNull();
  });
});

describe('Strategy integration with BacktestEngine', () => {
  it('Momentum should produce trades on trending data', async () => {
    const closes = [
      ...Array.from({ length: 40 }, (_, i) => 100 + i * 0.5),
      ...Array.from({ length: 40 }, (_, i) => 120 - i * 0.5),
      ...Array.from({ length: 40 }, (_, i) => 100 + i * 0.3),
    ];
    const candles = makeCandles(closes);

    const strategy = new MomentumStrategy({
      positionSize: 0.2, minTrendStrength: 0.1, trailingStopPercent: 2,
    });
    const engine = new BacktestEngine({
      initialBalance: 10000, slippageModel: 'none', takerFee: 0.001, warmUpPeriod: 50,
    });

    const results = await engine.run(strategy, candles, { enableLogging: false });
    expect(results.summary.totalTrades).toBeGreaterThan(0);
    expect(results.summary.finalBalance).toBeGreaterThan(0);
  });

  it('Mean Reversion should produce trades on oscillating data', async () => {
    const closes = [];
    for (let i = 0; i < 120; i++) {
      closes.push(100 + 20 * Math.sin(i * 2 * Math.PI / 40));
    }
    const candles = makeCandles(closes);

    const strategy = new MeanReversionStrategy({
      positionSize: 0.1, rsiOversold: 35, rsiOverbought: 65, stopLossPercent: 5,
    });
    const engine = new BacktestEngine({
      initialBalance: 10000, slippageModel: 'none', takerFee: 0.001, warmUpPeriod: 50,
    });

    const results = await engine.run(strategy, candles, { enableLogging: false });
    expect(results.summary.totalTrades).toBeGreaterThan(0);
  });
});
