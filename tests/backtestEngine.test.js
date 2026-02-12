// vitest globals (describe, it, expect) are injected via vitest.config.js globals: true
const BacktestEngine = require('../src/services/backtestEngine');

function makeCandles(closes) {
  return closes.map((close, i) => ({
    timestamp: 1000000 + i * 3600000,
    open: close, high: close * 1.01, low: close * 0.99, close, volume: 100,
  }));
}

function alwaysBuyStrategy() {
  let bought = false;
  return {
    name: 'AlwaysBuy',
    generateSignal: async ({ price, indicators }) => {
      if (!bought && indicators?.warmedUp) {
        bought = true;
        return { action: 'buy', confidence: 1, price, amount: 0.5 };
      }
      return { action: 'hold', confidence: 0 };
    },
    updateParams: () => { bought = false; },
    reset: () => { bought = false; },
  };
}

function buyThenSellStrategy() {
  let state = 'ready';
  let count = 0;
  return {
    name: 'BuyThenSell',
    generateSignal: async ({ price, indicators }) => {
      if (!indicators?.warmedUp) return { action: 'hold', confidence: 0 };
      count++;
      if (state === 'ready' && count === 1) {
        state = 'holding';
        return { action: 'buy', confidence: 1, price, amount: 0.5 };
      }
      if (state === 'holding' && count >= 5) {
        state = 'done';
        return { action: 'sell', confidence: 1, price, amount: 0.5 };
      }
      return { action: 'hold', confidence: 0 };
    },
    updateParams: () => { state = 'ready'; count = 0; },
    reset: () => { state = 'ready'; count = 0; },
  };
}

describe('BacktestEngine', () => {
  describe('basic operation', () => {
    it('should return results with correct structure', async () => {
      const candles = makeCandles(Array(60).fill(100));
      const engine = new BacktestEngine({ initialBalance: 10000 });
      const results = await engine.run(alwaysBuyStrategy(), candles, { enableLogging: false });

      expect(results).toHaveProperty('summary');
      expect(results).toHaveProperty('trades');
      expect(results).toHaveProperty('equityCurve');
      expect(results).toHaveProperty('signals');
      expect(results).toHaveProperty('drawdowns');
      expect(results.summary.initialBalance).toBe(10000);
    });

    it('should throw on empty data', async () => {
      const engine = new BacktestEngine();
      await expect(engine.run(alwaysBuyStrategy(), [])).rejects.toThrow('No historical data');
    });

    it('should have 0 return with no signals', async () => {
      const candles = makeCandles(Array(60).fill(100));
      const holdStrategy = {
        name: 'Hold',
        generateSignal: async () => ({ action: 'hold', confidence: 0 }),
        updateParams: () => {},
      };
      const engine = new BacktestEngine({ initialBalance: 10000 });
      const results = await engine.run(holdStrategy, candles, { enableLogging: false });

      expect(results.summary.totalReturn).toBeCloseTo(0, 5);
      expect(results.summary.totalTrades).toBe(0);
    });
  });

  describe('trade execution', () => {
    it('should deduct fees on buy', async () => {
      const candles = makeCandles(Array(60).fill(100));
      const engine = new BacktestEngine({ initialBalance: 10000, takerFee: 0.002, slippageModel: 'none' });
      const results = await engine.run(alwaysBuyStrategy(), candles, { enableLogging: false });

      const buyTrade = results.trades.find(t => t.side === 'buy');
      expect(buyTrade).toBeDefined();
      expect(buyTrade.fee).toBeGreaterThan(0);
    });

    it('should not allow selling without holdings (no shorting)', async () => {
      const sellOnly = {
        name: 'SellOnly',
        generateSignal: async ({ price, indicators }) => {
          if (indicators?.warmedUp) return { action: 'sell', confidence: 1, price, amount: 100 };
          return { action: 'hold', confidence: 0 };
        },
        updateParams: () => {},
      };

      const candles = makeCandles(Array(60).fill(100));
      const engine = new BacktestEngine({ initialBalance: 10000, slippageModel: 'none' });
      const results = await engine.run(sellOnly, candles, { enableLogging: false });

      expect(results.trades.filter(t => t.side === 'sell').length).toBe(0);
      expect(results.summary.finalBalance).toBeCloseTo(10000, 5);
    });

    it('should close all positions at end', async () => {
      const candles = makeCandles(Array(60).fill(100));
      const engine = new BacktestEngine({ initialBalance: 10000, slippageModel: 'none' });
      const results = await engine.run(alwaysBuyStrategy(), candles, { enableLogging: false });

      const lastTrade = results.trades[results.trades.length - 1];
      expect(lastTrade.side).toBe('sell');
    });
  });

  describe('buy affordability', () => {
    it('should buy what it can afford when requesting too much', async () => {
      let buyCount = 0;
      const greedyBuyer = {
        name: 'Greedy',
        generateSignal: async ({ price, indicators }) => {
          if (indicators?.warmedUp && buyCount < 1) {
            buyCount++;
            // Request 1000 absolute units @ $100 = $100,000 — way over $10,000 balance
            return { action: 'buy', confidence: 1, price, amount: 1000 };
          }
          return { action: 'hold', confidence: 0 };
        },
        updateParams: () => { buyCount = 0; },
      };

      const candles = makeCandles(Array(60).fill(100));
      const engine = new BacktestEngine({ initialBalance: 10000, slippageModel: 'none', takerFee: 0 });
      const results = await engine.run(greedyBuyer, candles, { enableLogging: false });

      const buyTrade = results.trades.find(t => t.side === 'buy');
      expect(buyTrade).toBeDefined();
      // Should have bought ~100 units ($10,000 / $100) instead of 1000
      expect(buyTrade.amount).toBeCloseTo(100, 0);
      // Balance should be ~$0 after buying
      expect(buyTrade.balance).toBeCloseTo(0, 0);
    });
  });

  describe('Sharpe ratio', () => {
    it('should be 0 for flat equity', async () => {
      const candles = makeCandles(Array(60).fill(100));
      const holdStrategy = {
        name: 'Hold',
        generateSignal: async () => ({ action: 'hold', confidence: 0 }),
        updateParams: () => {},
      };
      const engine = new BacktestEngine({ initialBalance: 10000 });
      const results = await engine.run(holdStrategy, candles, { enableLogging: false });
      expect(results.summary.sharpeRatio).toBe(0);
    });

    it('should auto-detect timeframe', async () => {
      const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 5));
      const candles = closes.map((close, i) => ({
        timestamp: 1000000 + i * 4 * 3600000,
        open: close, high: close * 1.01, low: close * 0.99, close, volume: 100,
      }));

      const engine = new BacktestEngine({ initialBalance: 10000 });
      await engine.run(alwaysBuyStrategy(), candles, { enableLogging: false });
      expect(engine.config.timeframeMs).toBe(4 * 3600000);
    });
  });

  describe('slippage', () => {
    it('should apply fixed slippage on buys', async () => {
      const candles = makeCandles(Array(60).fill(100));
      const engine = new BacktestEngine({
        initialBalance: 10000, slippageModel: 'fixed', slippageBps: 10, takerFee: 0,
      });
      const results = await engine.run(alwaysBuyStrategy(), candles, { enableLogging: false });

      const buyTrade = results.trades.find(t => t.side === 'buy');
      expect(buyTrade.price).toBeGreaterThan(100);
      expect(buyTrade.price).toBeCloseTo(100.1, 1);
    });
  });
});
