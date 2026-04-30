const SignalAggregator = require('../../src/services/SignalAggregator');

// Mock logger
vi.mock('../../src/utils/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}));

describe('SignalAggregator', () => {
  let aggregator;

  beforeEach(() => {
    vi.clearAllMocks();
    aggregator = new SignalAggregator();
  });

  describe('constructor', () => {
    it('should initialize with default config', () => {
      expect(aggregator.config.requireConsensus).toBe(true);
      expect(aggregator.config.minConsensusCount).toBe(2);
      expect(aggregator.config.minCombinedConfidence).toBe(0.7);
    });

    it('should allow overriding config', () => {
      const customAggregator = new SignalAggregator({
        minConsensusCount: 3,
        minCombinedConfidence: 0.8
      });
      expect(customAggregator.config.minConsensusCount).toBe(3);
      expect(customAggregator.config.minCombinedConfidence).toBe(0.8);
    });
  });

  describe('registerStrategy', () => {
    it('should register a new strategy and set default performance metrics', () => {
      aggregator.registerStrategy('strategy1');
      const perf = aggregator.strategyPerformance.get('strategy1');
      expect(perf).toBeDefined();
      expect(perf.weight).toBe(1.0);
      expect(perf.signals).toBe(0);
    });

    it('should not overwrite an existing strategy', () => {
      aggregator.registerStrategy('strategy1', 2.0);
      aggregator.strategyPerformance.get('strategy1').signals = 5;

      aggregator.registerStrategy('strategy1', 1.0);
      const perf = aggregator.strategyPerformance.get('strategy1');
      expect(perf.weight).toBe(2.0);
      expect(perf.signals).toBe(5);
    });
  });

  describe('aggregate', () => {
    it('should return hold for empty signals', () => {
      const result = aggregator.aggregate([]);
      expect(result.action).toBe('hold');
      expect(result.reason).toBe('No actionable signals');
    });

    it('should return hold for signals without confidence or action', () => {
      const result = aggregator.aggregate([{ action: 'hold', confidence: 1 }]);
      expect(result.action).toBe('hold');
      expect(result.reason).toBe('No actionable signals');
    });

    it('should return hold when insufficient consensus', () => {
      const signals = [
        { action: 'buy', confidence: 0.8, strategy: 's1' }
      ];
      const result = aggregator.aggregate(signals);
      expect(result.action).toBe('hold');
      expect(result.reason).toContain('Insufficient consensus');
    });

    it('should aggregate buy signals when consensus is reached', () => {
      aggregator.registerStrategy('s1');
      aggregator.registerStrategy('s2');
      const signals = [
        { action: 'buy', confidence: 0.8, strategy: 's1', price: 100, amount: 0.1 },
        { action: 'buy', confidence: 0.9, strategy: 's2', price: 100, amount: 0.1 }
      ];
      const result = aggregator.aggregate(signals);
      expect(result.action).toBe('buy');
      expect(result.confidence).toBeGreaterThanOrEqual(0.85);
      expect(result.sources).toContain('s1');
      expect(result.sources).toContain('s2');
    });

    it('should return hold if combined confidence is below threshold', () => {
      aggregator.registerStrategy('s1');
      aggregator.registerStrategy('s2');
      const signals = [
        { action: 'buy', confidence: 0.5, strategy: 's1', price: 100 },
        { action: 'buy', confidence: 0.6, strategy: 's2', price: 100 }
      ];
      const result = aggregator.aggregate(signals);
      expect(result.action).toBe('hold');
      expect(result.reason).toContain('below threshold');
    });

    it('should block buys in strong bear market (CASH IS KING MODE)', () => {
      const signals = [
        { action: 'buy', confidence: 0.8, strategy: 's1' },
        { action: 'buy', confidence: 0.9, strategy: 's2' }
      ];
      const result = aggregator.aggregate(signals, { regime: 'strong_downtrend' });
      expect(result.action).toBe('hold');
      expect(result.reason).toContain('Bear market defense');
    });

    it('should handle conflict and resolve to weighted by default', () => {
      const signals = [
        { action: 'buy', confidence: 0.9, strategy: 's1', price: 100 },
        { action: 'buy', confidence: 0.8, strategy: 's2', price: 100 },
        { action: 'sell', confidence: 0.4, strategy: 's3', price: 100 }
      ];
      const result = aggregator.aggregate(signals);
      expect(result.action).toBe('buy');
      expect(result.conflict).toBe(true);
      expect(result.overriddenSignals).toContain('s3');
    });
  });

  describe('resolveConflict', () => {
    const buySignals = [
      { action: 'buy', confidence: 0.9, strategy: 's1', price: 100 }
    ];
    const sellSignals = [
      { action: 'sell', confidence: 0.6, strategy: 's2', price: 100 }
    ];

    it('should return conservative hold by default', () => {
      aggregator.config.onConflict = 'conservative';
      const result = aggregator.resolveConflict(buySignals, sellSignals, {});
      expect(result.action).toBe('hold');
      expect(result.reason).toContain('Conflict');
    });

    it('should resolve to highest confidence', () => {
      aggregator.config.onConflict = 'highest_confidence';
      const result = aggregator.resolveConflict(buySignals, sellSignals, {});
      expect(result.action).toBe('buy');
      expect(result.reason).toContain('highest confidence');
    });
  });

  describe('aggregateSide and risk parameters', () => {
    it('should properly combine risk parameters and trailing stop', () => {
      const signals = [
        { action: 'buy', confidence: 0.8, strategy: 's1', stopLoss: 90, takeProfit: 120, trailingStop: 5, price: 100, amount: 0.1 },
        { action: 'buy', confidence: 0.9, strategy: 's2', stopLoss: 95, takeProfit: 110, trailingStop: 3, price: 100, amount: 0.2 }
      ];
      const result = aggregator.aggregateSide(signals, 'buy');

      expect(result.stopLoss).toBe(95);
      expect(result.takeProfit).toBe(110);
      expect(result.trailingStop).toBe(4);
    });

    it('should properly combine risk parameters for sell signals', () => {
      const signals = [
        { action: 'sell', confidence: 0.8, strategy: 's1', stopLoss: 110, takeProfit: 80, trailingStop: 5, price: 100, amount: 0.1 },
        { action: 'sell', confidence: 0.9, strategy: 's2', stopLoss: 105, takeProfit: 90, trailingStop: 3, price: 100, amount: 0.2 }
      ];
      const result = aggregator.aggregateSide(signals, 'sell');

      expect(result.stopLoss).toBe(105);
      expect(result.takeProfit).toBe(90);
    });
  });

  describe('Performance Tracking', () => {
    it('should record trade results and adjust strategy weights', () => {
      aggregator.registerStrategy('s1');

      aggregator.recentSignals.push({
        id: 'test_id',
        components: [ { strategy: 's1' } ]
      });

      aggregator.recordTradeResult('test_id', { pnl: 10 });
      const perf = aggregator.strategyPerformance.get('s1');
      expect(perf.wins).toBe(1);
      expect(perf.winRate).toBe(1);
      expect(perf.weight).toBeGreaterThan(1.0);
    });

    it('should decrease weight on losses', () => {
      aggregator.registerStrategy('s2');

      aggregator.recentSignals.push({
        id: 'test_id2',
        components: [ { strategy: 's2' } ]
      });

      aggregator.recordTradeResult('test_id2', { pnl: -10 });
      const perf = aggregator.strategyPerformance.get('s2');
      expect(perf.losses).toBe(1);
      expect(perf.winRate).toBe(0);
      expect(perf.weight).toBeLessThan(1.0);
    });

    it('should return performance summary', () => {
      aggregator.registerStrategy('s1');
      const summary = aggregator.getPerformance();
      expect(summary.totalAggregated).toBe(0);
      expect(summary.strategyPerformance.length).toBe(1);
    });

    it('should reset state correctly', () => {
      aggregator.registerStrategy('s1');
      aggregator.recentSignals.push({});

      aggregator.reset();

      expect(aggregator.strategyPerformance.size).toBe(0);
      expect(aggregator.recentSignals.length).toBe(0);
    });
  });
});
