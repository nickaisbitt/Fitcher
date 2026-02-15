// vitest globals (describe, it, expect) are injected via vitest.config.js globals: true
const MetricsCollector = require('../../src/services/metricsCollector');

describe('MetricsCollector', () => {
  let collector;

  beforeEach(() => {
    collector = new MetricsCollector({ retentionPeriod: 60000, maxDataPoints: 100 });
  });

  // ── recordTrade ──────────────────────────────────────────────

  describe('recordTrade', () => {
    it('adds to metrics.trades and increments counters', () => {
      collector.recordTrade({
        order: {
          id: 'o1', userId: 'u1', strategyId: 's1', pair: 'BTC/USD',
          side: 'buy', filledAmount: 0.5, averagePrice: 50000,
          fee: 1, realizedPnL: 100, status: 'filled',
          createdAt: Date.now() - 200, filledAt: Date.now()
        }
      });

      expect(collector.metrics.trades).toHaveLength(1);
      expect(collector.counters.tradesTotal).toBe(1);
    });

    it('increments tradesSuccessful for a winning (filled) trade', () => {
      collector.recordTrade({
        order: {
          id: 'o1', userId: 'u1', pair: 'BTC/USD', side: 'buy',
          filledAmount: 1, averagePrice: 100, fee: 0,
          realizedPnL: 50, status: 'filled',
          createdAt: Date.now() - 100, filledAt: Date.now()
        }
      });

      expect(collector.counters.tradesSuccessful).toBe(1);
      expect(collector.counters.tradesFailed).toBe(0);
    });

    it('increments tradesFailed for a losing (non-filled) trade', () => {
      collector.recordTrade({
        order: {
          id: 'o2', userId: 'u1', pair: 'BTC/USD', side: 'sell',
          filledAmount: 0, averagePrice: 0, fee: 0,
          realizedPnL: -10, status: 'cancelled',
          createdAt: Date.now() - 100, filledAt: Date.now()
        }
      });

      expect(collector.counters.tradesFailed).toBe(1);
      expect(collector.counters.tradesSuccessful).toBe(0);
    });

    it('records latency from createdAt/filledAt', () => {
      const createdAt = Date.now() - 500;
      const filledAt = Date.now();

      collector.recordTrade({
        order: {
          id: 'o3', userId: 'u1', pair: 'BTC/USD', side: 'buy',
          filledAmount: 1, averagePrice: 100, fee: 0,
          realizedPnL: 0, status: 'filled',
          createdAt, filledAt
        }
      });

      expect(collector.metrics.latency).toHaveLength(1);
      expect(collector.metrics.latency[0].value).toBe(filledAt - createdAt);
    });
  });

  // ── recordSignal ─────────────────────────────────────────────

  describe('recordSignal', () => {
    it('adds to metrics.signals and increments signalsGenerated', () => {
      collector.recordSignal({
        userId: 'u1', strategyId: 's1',
        signal: { action: 'buy', pair: 'BTC/USD', price: 50000 }
      });

      expect(collector.metrics.signals).toHaveLength(1);
      expect(collector.counters.signalsGenerated).toBe(1);
    });

    it('does not increment signalsExecuted for hold signal', () => {
      collector.recordSignal({
        userId: 'u1', strategyId: 's1',
        signal: { action: 'hold' }
      });

      expect(collector.counters.signalsGenerated).toBe(1);
      expect(collector.counters.signalsExecuted).toBe(0);
    });

    it('increments signalsExecuted for non-hold signal', () => {
      collector.recordSignal({
        userId: 'u1', strategyId: 's1',
        signal: { action: 'buy', pair: 'BTC/USD' }
      });

      expect(collector.counters.signalsExecuted).toBe(1);
    });
  });

  // ── recordError ──────────────────────────────────────────────

  describe('recordError', () => {
    it('adds to metrics.errors and increments errorsTotal', () => {
      collector.recordError('testError', new Error('boom'), { detail: 'x' });

      expect(collector.metrics.errors).toHaveLength(1);
      expect(collector.counters.errorsTotal).toBe(1);
      expect(collector.metrics.errors[0].type).toBe('testError');
      expect(collector.metrics.errors[0].message).toBe('boom');
    });
  });

  // ── recordEvent ──────────────────────────────────────────────

  describe('recordEvent', () => {
    it('writes to metrics.events (NOT metrics.orders)', () => {
      collector.recordEvent('circuitBreaker', { userId: 'u1' });

      expect(collector.metrics.events).toHaveLength(1);
      expect(collector.metrics.events[0].type).toBe('circuitBreaker');
      // Regression: previously wrote to metrics.orders by mistake
      expect(collector.metrics.orders).toHaveLength(0);
    });
  });

  // ── recordEquity ─────────────────────────────────────────────

  describe('recordEquity', () => {
    it('tracks equity per user', () => {
      collector.recordEquity('u1', 10000, { cash: 5000 });
      collector.recordEquity('u2', 20000);

      expect(collector.metrics.equity.get('u1')).toHaveLength(1);
      expect(collector.metrics.equity.get('u2')).toHaveLength(1);
      expect(collector.metrics.equity.get('u1')[0].equity).toBe(10000);
    });

    it('trims old entries by retention period', () => {
      // Insert an entry with an old timestamp
      collector.metrics.equity.set('u1', [
        { timestamp: Date.now() - 120000, equity: 5000 }
      ]);

      // Recording new equity triggers trimming
      collector.recordEquity('u1', 10000);

      const history = collector.metrics.equity.get('u1');
      // The old entry (120s ago) should be removed because retention = 60s
      expect(history.every(e => e.timestamp >= Date.now() - 61000)).toBe(true);
    });

    it('respects maxDataPoints', () => {
      const smallCollector = new MetricsCollector({ maxDataPoints: 3, retentionPeriod: 999999999 });

      for (let i = 0; i < 5; i++) {
        smallCollector.recordEquity('u1', i * 1000);
      }

      expect(smallCollector.metrics.equity.get('u1').length).toBeLessThanOrEqual(3);
    });
  });

  // ── getTradeStats ────────────────────────────────────────────

  describe('getTradeStats', () => {
    function addTrades() {
      const base = {
        pair: 'BTC/USD', side: 'buy', filledAmount: 1,
        averagePrice: 100, fee: 0, status: 'filled',
        createdAt: Date.now() - 100, filledAt: Date.now()
      };

      collector.recordTrade({ order: { ...base, id: 't1', userId: 'u1', realizedPnL: 100 } });
      collector.recordTrade({ order: { ...base, id: 't2', userId: 'u1', realizedPnL: -50 } });
      collector.recordTrade({ order: { ...base, id: 't3', userId: 'u2', realizedPnL: 200 } });
    }

    it('returns correct stats', () => {
      addTrades();
      const stats = collector.getTradeStats();

      expect(stats.total).toBe(3);
      expect(stats.winning).toBe(2);
      expect(stats.losing).toBe(1);
      expect(stats.winRate).toBeCloseTo(66.67, 1);
      expect(stats.totalPnl).toBe(250);
      expect(stats.avgPnl).toBeCloseTo(83.33, 1);
    });

    it('filters by userId', () => {
      addTrades();
      const stats = collector.getTradeStats('u1');

      expect(stats.total).toBe(2);
      expect(stats.totalPnl).toBe(50);
    });

    it('filters by since timestamp', () => {
      addTrades();
      // All trades are recent; filter with a future timestamp should yield zero
      const stats = collector.getTradeStats(null, Date.now() + 10000);
      expect(stats.total).toBe(0);
    });

    it('returns zeros for empty trades', () => {
      const stats = collector.getTradeStats();

      expect(stats.total).toBe(0);
      expect(stats.winning).toBe(0);
      expect(stats.losing).toBe(0);
      expect(stats.winRate).toBe(0);
      expect(stats.avgPnl).toBe(0);
      expect(stats.totalPnl).toBe(0);
    });
  });

  // ── getLatencyStats ──────────────────────────────────────────

  describe('getLatencyStats', () => {
    it('returns avg, min, max, p95, p99', () => {
      // Manually push latencies to avoid order creation overhead
      for (let i = 1; i <= 100; i++) {
        collector.metrics.latency.push({
          timestamp: Date.now(), type: 'orderExecution', value: i
        });
      }

      const stats = collector.getLatencyStats();

      expect(stats.avg).toBeCloseTo(50.5, 0);
      expect(stats.min).toBe(1);
      expect(stats.max).toBe(100);
      expect(stats.p95).toBe(96);
      expect(stats.p99).toBe(100);
    });

    it('returns zeros for empty latencies', () => {
      const stats = collector.getLatencyStats();

      expect(stats.avg).toBe(0);
      expect(stats.min).toBe(0);
      expect(stats.max).toBe(0);
      expect(stats.p95).toBe(0);
      expect(stats.p99).toBe(0);
    });
  });

  // ── getEquityCurve ───────────────────────────────────────────

  describe('getEquityCurve', () => {
    it('returns history for user', () => {
      collector.recordEquity('u1', 10000);
      collector.recordEquity('u1', 10500);

      const curve = collector.getEquityCurve('u1');
      expect(curve).toHaveLength(2);
      expect(curve[0].equity).toBe(10000);
      expect(curve[1].equity).toBe(10500);
    });

    it('returns empty array for unknown user', () => {
      expect(collector.getEquityCurve('unknown')).toEqual([]);
    });
  });

  // ── getCounters ──────────────────────────────────────────────

  describe('getCounters', () => {
    it('returns a copy of counters', () => {
      collector.counters.tradesTotal = 5;
      const counters = collector.getCounters();

      expect(counters.tradesTotal).toBe(5);
      // Mutating the copy should not affect the original
      counters.tradesTotal = 999;
      expect(collector.counters.tradesTotal).toBe(5);
    });
  });

  // ── getSummary ───────────────────────────────────────────────

  describe('getSummary', () => {
    it('includes all sections', () => {
      const summary = collector.getSummary();

      expect(summary).toHaveProperty('counters');
      expect(summary).toHaveProperty('tradeStats');
      expect(summary).toHaveProperty('latencyStats');
      expect(summary).toHaveProperty('errorCount');
      expect(summary).toHaveProperty('signalCount');
      expect(summary).toHaveProperty('retentionPeriod');
      expect(summary).toHaveProperty('dataPoints');
      expect(summary.dataPoints).toHaveProperty('trades');
      expect(summary.dataPoints).toHaveProperty('equityUsers');
    });
  });

  // ── trimOldData ──────────────────────────────────────────────

  describe('trimOldData', () => {
    it('removes entries older than retention period', () => {
      const arr = [
        { timestamp: Date.now() - 120000 },
        { timestamp: Date.now() - 30000 },
        { timestamp: Date.now() }
      ];

      collector.trimOldData(arr);
      // Retention is 60 000 ms; oldest entry (120s ago) should be removed
      expect(arr).toHaveLength(2);
    });

    it('caps array at maxDataPoints', () => {
      const arr = [];
      for (let i = 0; i < 150; i++) {
        arr.push({ timestamp: Date.now() });
      }

      collector.trimOldData(arr);
      expect(arr.length).toBeLessThanOrEqual(100);
    });
  });

  // ── reset ────────────────────────────────────────────────────

  describe('reset', () => {
    it('clears all metrics and counters', () => {
      collector.recordSignal({ userId: 'u1', signal: { action: 'buy' } });
      collector.recordError('e', new Error('x'));
      collector.recordEvent('test', {});
      collector.recordEquity('u1', 10000);

      collector.reset();

      expect(collector.metrics.trades).toHaveLength(0);
      expect(collector.metrics.signals).toHaveLength(0);
      expect(collector.metrics.errors).toHaveLength(0);
      expect(collector.metrics.events).toHaveLength(0);
      expect(collector.metrics.latency).toHaveLength(0);
      expect(collector.metrics.equity.size).toBe(0);
      expect(collector.counters.tradesTotal).toBe(0);
      expect(collector.counters.signalsGenerated).toBe(0);
      expect(collector.counters.errorsTotal).toBe(0);
    });
  });
});
