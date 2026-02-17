const logger = require('../utils/logger');

/**
 * SignalAggregator - Combines signals from multiple strategies
 * Supports consensus mode (2+ strategies must agree)
 * Weights signals by strategy performance
 */
class SignalAggregator {
  constructor(config = {}) {
    this.config = {
      // Consensus mode
      requireConsensus: config.requireConsensus !== false,
      minConsensusCount: config.minConsensusCount || 2,
      
      // Confidence thresholds
      minCombinedConfidence: config.minCombinedConfidence || 0.7,
      
      // Signal weights by strategy (default: equal weight)
      strategyWeights: config.strategyWeights || {},
      
      // Performance-based weight adjustment
      usePerformanceWeights: config.usePerformanceWeights !== false,
      performanceWindow: config.performanceWindow || 50, // Last 50 signals
      
      // Conflict resolution
      onConflict: config.onConflict || 'weighted', // 'weighted' | 'highest_confidence' | 'conservative'
      
      ...config
    };
    
    // Track strategy performance
    this.strategyPerformance = new Map();
    
    // Signal history for analysis
    this.signalHistory = [];
    
    // Recent aggregated signals
    this.recentSignals = [];
  }

  /**
   * Register a strategy for tracking
   */
  registerStrategy(strategyName, initialWeight = 1.0) {
    if (!this.strategyPerformance.has(strategyName)) {
      this.strategyPerformance.set(strategyName, {
        name: strategyName,
        weight: initialWeight,
        signals: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        avgConfidence: 0,
        profitFactor: 0
      });
      logger.info(`SignalAggregator: Registered strategy ${strategyName}`);
    }
  }

  /**
   * Aggregate signals from multiple strategies
   * @param {Array} signals - Array of signal objects from different strategies
   * @param {Object} marketData - Current market data
   * @returns {Object} Aggregated signal
   */
  aggregate(signals, marketData = {}) {
    try {
      // Filter out hold signals and invalid signals
      const actionableSignals = signals.filter(s => 
        s && s.action && s.action !== 'hold' && s.confidence > 0
      );

      if (actionableSignals.length === 0) {
        return {
          action: 'hold',
          confidence: 0,
          reason: 'No actionable signals',
          sources: []
        };
      }

      // Separate buy and sell signals
      const buySignals = actionableSignals.filter(s => s.action === 'buy');
      const sellSignals = actionableSignals.filter(s => s.action === 'sell');

      // Check for consensus
      const hasBuyConsensus = buySignals.length >= this.config.minConsensusCount;
      const hasSellConsensus = sellSignals.length >= this.config.minConsensusCount;

    // Check for conflicts (both buy and sell signals present)
    const hasBuyConsensus = buySignals.length >= this.config.minConsensusCount;
    const hasSellConsensus = sellSignals.length >= this.config.minConsensusCount;

    // --- BEAR MARKET DEFENSE (CASH IS KING) ---
    const alignment = marketData.regime || 'neutral';
    const isBearMarket = alignment.includes('downtrend');
    
    if (buySignals.length > 0 && isBearMarket) {
      logger.warn(`CASH IS KING MODE: Blocking ${buySignals.length} buy signals due to ${alignment} trend on 1D/4H.`);
      // Only allow buys if confidence is extremely high OR trend is neutral/up
      const highConfidenceBuys = buySignals.filter(s => s.confidence > 0.9);
      
      if (highConfidenceBuys.length === 0) {
        return {
          action: 'hold',
          confidence: 0,
          reason: `Bear market defense: ${alignment} trend detected. No high-confidence buys allowed.`,
          sources: buySignals.map(s => s.strategy)
        };
      }
      // If we proceed, we should only consider the high-confidence buys
      buySignals = highConfidenceBuys;
    }
    // -------------------------------------------
    
    // Check for conflicts (both buy and sell signals present)
    const hasConflict = buySignals.length > 0 && sellSignals.length > 0;

      // Handle conflicts
      if (hasConflict) {
        return this.resolveConflict(buySignals, sellSignals, marketData);
      }

      // No conflict - aggregate by side
      let aggregatedSignal;
      
      if (hasBuyConsensus || (!this.config.requireConsensus && buySignals.length > 0)) {
        aggregatedSignal = this.aggregateSide(buySignals, 'buy');
      } else if (hasSellConsensus || (!this.config.requireConsensus && sellSignals.length > 0)) {
        aggregatedSignal = this.aggregateSide(sellSignals, 'sell');
      } else {
        // No consensus reached
        const side = buySignals.length > sellSignals.length ? 'buy' : 'sell';
        const signals = side === 'buy' ? buySignals : sellSignals;
        
        return {
          action: 'hold',
          confidence: Math.max(...signals.map(s => s.confidence)) * 0.5,
          reason: `Insufficient consensus (${signals.length}/${this.config.minConsensusCount})`,
          sources: signals.map(s => s.strategy),
          partialSignal: true
        };
      }

      // Check minimum combined confidence
      if (aggregatedSignal.confidence < this.config.minCombinedConfidence) {
        return {
          action: 'hold',
          confidence: aggregatedSignal.confidence,
          reason: `Combined confidence ${aggregatedSignal.confidence.toFixed(2)} below threshold ${this.config.minCombinedConfidence}`,
          sources: aggregatedSignal.sources
        };
      }

      // Store signal
      this.storeAggregatedSignal(aggregatedSignal);

      logger.info(`SignalAggregator: ${aggregatedSignal.action} signal (${aggregatedSignal.confidence.toFixed(2)}) from [${aggregatedSignal.sources.join(', ')}]`);

      return aggregatedSignal;

    } catch (error) {
      logger.error('SignalAggregator error:', error);
      return {
        action: 'hold',
        confidence: 0,
        reason: 'Aggregation error'
      };
    }
  }

  /**
   * Aggregate signals from one side (all buys or all sells)
   */
  aggregateSide(signals, action) {
    // Get weights for each strategy
    const weightedSignals = signals.map(signal => {
      const strategyPerf = this.strategyPerformance.get(signal.strategy);
      const baseWeight = this.config.strategyWeights[signal.strategy] || 1.0;
      const perfWeight = strategyPerf ? strategyPerf.weight : 1.0;
      
      return {
        ...signal,
        weight: baseWeight * perfWeight
      };
    });

    // Calculate weighted average confidence
    const totalWeight = weightedSignals.reduce((sum, s) => sum + s.weight, 0);
    const weightedConfidence = weightedSignals.reduce(
      (sum, s) => sum + (s.confidence * s.weight), 0
    ) / totalWeight;

    // Combine position sizes (weighted average)
    const weightedSize = weightedSignals.reduce(
      (sum, s) => sum + ((s.amount || 0) * s.weight), 0
    ) / totalWeight;

    // Combine reasons
    const allReasons = weightedSignals.map(s => `${s.strategy}: ${s.reason}`);
    const uniqueReasons = [...new Set(allReasons)];

    // Select best stops (most conservative)
    const stopLosses = weightedSignals
      .filter(s => s.stopLoss)
      .map(s => s.stopLoss);
    const takeProfits = weightedSignals
      .filter(s => s.takeProfit)
      .map(s => s.takeProfit);

    const stopLoss = action === 'buy' 
      ? Math.max(...stopLosses, 0)  // Highest stop for buys
      : Math.min(...stopLosses, Infinity); // Lowest stop for sells
    
    const takeProfit = action === 'buy'
      ? Math.min(...takeProfits, Infinity)  // Lowest target for buys
      : Math.max(...takeProfits, 0);        // Highest target for sells

    return {
      action,
      confidence: Math.min(weightedConfidence, 0.95),
      reason: `${signals.length} strategies agree: ${uniqueReasons.slice(0, 2).join('; ')}`,
      sources: signals.map(s => s.strategy),
      amount: Math.min(weightedSize, 0.20), // Cap at 20%
      price: signals[0].price, // Use first signal's price
      pair: signals[0].pair,
      timestamp: Date.now(),
      
      // Combined risk parameters
      stopLoss: stopLoss > 0 ? stopLoss : undefined,
      takeProfit: takeProfit < Infinity ? takeProfit : undefined,
      trailingStop: this.selectTrailingStop(weightedSignals),
      
      // Execution
      urgency: weightedConfidence > 0.85 ? 'high' : 'normal',
      orderType: weightedConfidence > 0.85 ? 'market' : 'limit',
      
      // Component signals
      components: signals.map(s => ({
        strategy: s.strategy,
        confidence: s.confidence,
        reason: s.reason
      }))
    };
  }

  /**
   * Resolve conflicts when strategies disagree
   */
  resolveConflict(buySignals, sellSignals, marketData) {
    logger.warn(`Signal conflict: ${buySignals.length} buy vs ${sellSignals.length} sell signals`);

    switch (this.config.onConflict) {
      case 'weighted':
        return this.resolveWeightedConflict(buySignals, sellSignals);
        
      case 'highest_confidence':
        return this.resolveHighestConfidence(buySignals, sellSignals);
        
      case 'conservative':
      default:
        return {
          action: 'hold',
          confidence: 0,
          reason: `Conflict: ${buySignals.length} buy vs ${sellSignals.length} sell - staying neutral`,
          conflict: true,
          buySources: buySignals.map(s => s.strategy),
          sellSources: sellSignals.map(s => s.strategy)
        };
    }
  }

  /**
   * Resolve by weighted confidence
   */
  resolveWeightedConflict(buySignals, sellSignals) {
    const buyAgg = this.aggregateSide(buySignals, 'buy');
    const sellAgg = this.aggregateSide(sellSignals, 'sell');

    if (buyAgg.confidence > sellAgg.confidence * 1.2) {
      // Buy confidence is significantly higher
      return {
        ...buyAgg,
        reason: `${buyAgg.reason} (overrode ${sellSignals.length} sell signals)`,
        conflict: true,
        overriddenSignals: sellSignals.map(s => s.strategy)
      };
    } else if (sellAgg.confidence > buyAgg.confidence * 1.2) {
      // Sell confidence is significantly higher
      return {
        ...sellAgg,
        reason: `${sellAgg.reason} (overrode ${buySignals.length} buy signals)`,
        conflict: true,
        overriddenSignals: buySignals.map(s => s.strategy)
      };
    }

    // Too close to call
    return {
      action: 'hold',
      confidence: Math.abs(buyAgg.confidence - sellAgg.confidence),
      reason: 'Conflicting signals with similar confidence - staying neutral',
      conflict: true,
      buyConfidence: buyAgg.confidence,
      sellConfidence: sellAgg.confidence
    };
  }

  /**
   * Resolve by highest individual confidence
   */
  resolveHighestConfidence(buySignals, sellSignals) {
    const highestBuy = buySignals.reduce((max, s) => 
      s.confidence > max.confidence ? s : max, buySignals[0]);
    const highestSell = sellSignals.reduce((max, s) => 
      s.confidence > max.confidence ? s : max, sellSignals[0]);

    if (highestBuy.confidence > highestSell.confidence) {
      return {
        ...highestBuy,
        reason: `${highestBuy.reason} (highest confidence in conflict)`,
        conflict: true
      };
    } else {
      return {
        ...highestSell,
        reason: `${highestSell.reason} (highest confidence in conflict)`,
        conflict: true
      };
    }
  }

  /**
   * Select best trailing stop from component signals
   */
  selectTrailingStop(signals) {
    const stops = signals
      .filter(s => s.trailingStop)
      .map(s => s.trailingStop);
    
    if (stops.length === 0) return undefined;
    
    // Use average
    return stops.reduce((sum, s) => sum + s, 0) / stops.length;
  }

  /**
   * Store aggregated signal in history
   */
  storeAggregatedSignal(signal) {
    this.recentSignals.push({
      ...signal,
      id: `agg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    });

    if (this.recentSignals.length > 500) {
      this.recentSignals.shift();
    }
  }

  /**
   * Record trade result for performance tracking
   */
  recordTradeResult(signalId, result) {
    const signal = this.recentSignals.find(s => s.id === signalId);
    if (!signal) return;

    // Update performance for each contributing strategy
    for (const component of signal.components || []) {
      const perf = this.strategyPerformance.get(component.strategy);
      if (perf) {
        perf.signals++;
        if (result.pnl > 0) {
          perf.wins++;
        } else {
          perf.losses++;
        }
        
        // Recalculate metrics
        perf.winRate = perf.wins / perf.signals;
        
        // Adjust weight based on performance
        if (this.config.usePerformanceWeights) {
          if (perf.winRate > 0.6) {
            perf.weight = Math.min(perf.weight * 1.1, 2.0);
          } else if (perf.winRate < 0.4) {
            perf.weight = Math.max(perf.weight * 0.9, 0.5);
          }
        }
      }
    }
  }

  /**
   * Get performance summary
   */
  getPerformance() {
    return {
      totalAggregated: this.recentSignals.length,
      recentSignals: this.recentSignals.slice(-10),
      strategyPerformance: Array.from(this.strategyPerformance.values())
    };
  }

  /**
   * Reset all data
   */
  reset() {
    this.strategyPerformance.clear();
    this.signalHistory = [];
    this.recentSignals = [];
    logger.info('SignalAggregator reset');
  }
}

module.exports = SignalAggregator;
