const logger = require('../utils/logger');

/**
 * StrategyOptimizer - Walk-forward optimization framework
 * Optimizes strategy parameters to maximize performance metrics
 */
class StrategyOptimizer {
  constructor(config = {}) {
    this.config = {
      trainRatio: config.trainRatio || 0.7, // 70% train, 30% test
      nSplits: config.nSplits || 3, // Number of walk-forward splits
      metric: config.metric || 'sharpeRatio', // Optimization target
      minTrades: config.minTrades || 10, // Minimum trades for valid results
      ...config
    };
    
    this.results = [];
  }

  /**
   * Run walk-forward optimization
   * @param {Object} strategy - Strategy instance
   * @param {Array} historicalData - Full historical dataset
   * @param {Object} paramGrid - Parameter grid to search
   * @param {Object} backtestConfig - Backtest configuration
   */
  async optimize(strategy, historicalData, paramGrid, backtestConfig) {
    try {
      logger.info('Starting walk-forward optimization...');
      logger.info(`Data points: ${historicalData.length}, Splits: ${this.config.nSplits}`);
      
      const BacktestEngine = require('./backtestEngine');
      const splits = this.createWalkForwardSplits(historicalData);
      
      const results = {
        splits: [],
        bestParams: null,
        bestScore: -Infinity,
        allResults: []
      };
      
      // Run optimization for each split
      for (let i = 0; i < splits.length; i++) {
        logger.info(`Processing split ${i + 1}/${splits.length}...`);
        
        const split = splits[i];
        const splitResult = await this.optimizeSplit(
          strategy,
          split.train,
          split.test,
          paramGrid,
          backtestConfig
        );
        
        results.splits.push({
          split: i + 1,
          trainPeriod: {
            start: split.train[0]?.timestamp,
            end: split.train[split.train.length - 1]?.timestamp,
            size: split.train.length
          },
          testPeriod: {
            start: split.test[0]?.timestamp,
            end: split.test[split.test.length - 1]?.timestamp,
            size: split.test.length
          },
          ...splitResult
        });
        
        // Track best overall parameters
        if (splitResult.testScore > results.bestScore) {
          results.bestScore = splitResult.testScore;
          results.bestParams = splitResult.bestParams;
        }
        
        results.allResults.push(...splitResult.allResults);
      }
      
      // Calculate aggregate statistics
      results.aggregate = this.calculateAggregateStats(results.splits);
      
      logger.info('✅ Walk-forward optimization completed');
      logger.info(`Best ${this.config.metric}: ${results.bestScore.toFixed(4)}`);
      logger.info('Best parameters:', results.bestParams);
      
      return results;
      
    } catch (error) {
      logger.error('Optimization error:', error);
      throw error;
    }
  }

  /**
   * Create walk-forward splits
   * @param {Array} data - Historical data
   */
  createWalkForwardSplits(data) {
    const splits = [];
    const totalSize = data.length;
    const splitSize = Math.floor(totalSize / this.config.nSplits);
    const trainSize = Math.floor(splitSize * this.config.trainRatio);
    const testSize = splitSize - trainSize;
    
    for (let i = 0; i < this.config.nSplits; i++) {
      const startIdx = i * testSize;
      const trainEndIdx = startIdx + trainSize;
      const testEndIdx = trainEndIdx + testSize;
      
      splits.push({
        train: data.slice(startIdx, trainEndIdx),
        test: data.slice(trainEndIdx, Math.min(testEndIdx, totalSize))
      });
    }
    
    return splits;
  }

  /**
   * Optimize a single split
   * @param {Object} strategy - Strategy instance
   * @param {Array} trainData - Training data
   * @param {Array} testData - Test data
   * @param {Object} paramGrid - Parameter grid
   * @param {Object} backtestConfig - Backtest config
   */
  async optimizeSplit(strategy, trainData, testData, paramGrid, backtestConfig) {
    const BacktestEngine = require('./backtestEngine');
    const combinations = this.generateParamCombinations(paramGrid);
    
    logger.info(`Testing ${combinations.length} parameter combinations...`);
    
    const results = [];
    let bestTrainScore = -Infinity;
    let bestParams = null;
    
    // Test each parameter combination on training data
    for (const params of combinations) {
      try {
        // Update strategy parameters
        strategy.updateParams(params);
        
        // Run backtest on training data
        const backtest = new BacktestEngine(backtestConfig);
        const trainResult = await backtest.run(strategy, trainData, { enableLogging: false });
        
        // Skip if not enough trades (but allow if it's the only combination)
        const minTrades = trainData.length < 100 ? 1 : this.config.minTrades;
        if (trainResult.summary.totalTrades < minTrades) {
          logger.debug(`Skipping params ${JSON.stringify(params)}: only ${trainResult.summary.totalTrades} trades`);
          // Still consider this combination if it's the first one
          if (bestParams === null && combinations.length === 1) {
            bestParams = params;
            bestTrainScore = this.calculateScore(trainResult.summary);
          }
          continue;
        }
        
        const trainScore = this.calculateScore(trainResult.summary);
        
        results.push({
          params,
          trainScore,
          trainResult: trainResult.summary
        });
        
        if (trainScore > bestTrainScore) {
          bestTrainScore = trainScore;
          bestParams = params;
        }
        
      } catch (error) {
        logger.warn(`Parameter combination failed:`, params, error.message);
      }
    }
    
    if (!bestParams) {
      // Return the first combination even if it has few trades
      if (combinations.length > 0) {
        logger.warn('No valid combinations with min trades, using first combination');
        bestParams = combinations[0];
        bestTrainScore = 0;
      } else {
        throw new Error('No valid parameter combinations found');
      }
    }
    
    // Test best parameters on out-of-sample data
    strategy.updateParams(bestParams);
    const testBacktest = new BacktestEngine(backtestConfig);
    const testResult = await testBacktest.run(strategy, testData, { enableLogging: false });
    const testScore = this.calculateScore(testResult.summary);
    
    return {
      bestParams,
      trainScore: bestTrainScore,
      testScore,
      testResult: testResult.summary,
      allResults: results
    };
  }

  /**
   * Generate all parameter combinations
   * @param {Object} paramGrid - Parameter grid
   */
  generateParamCombinations(paramGrid) {
    const keys = Object.keys(paramGrid);
    const values = Object.values(paramGrid);
    
    const combinations = [];
    
    const generate = (current, depth) => {
      if (depth === keys.length) {
        combinations.push({ ...current });
        return;
      }
      
      const key = keys[depth];
      const vals = values[depth];
      
      for (const val of vals) {
        current[key] = val;
        generate(current, depth + 1);
      }
    };
    
    generate({}, 0);
    return combinations;
  }

  /**
   * Calculate optimization score
   * @param {Object} summary - Backtest summary
   */
  calculateScore(summary) {
    switch (this.config.metric) {
      case 'sharpeRatio':
        return summary.sharpeRatio || 0;
        
      case 'totalReturn':
        return summary.totalReturn || 0;
        
      case 'profitFactor':
        return summary.profitFactor || 0;
        
      case 'winRate':
        return summary.winRate || 0;
        
      case 'calmarRatio':
        const maxDD = summary.maxDrawdownPercent || 1;
        return (summary.totalReturn || 0) / maxDD;
        
      case 'composite':
        // Weighted combination of multiple metrics
        const weights = {
          sharpeRatio: 0.3,
          totalReturn: 0.25,
          profitFactor: 0.2,
          winRate: 0.15,
          maxDrawdownPercent: -0.1 // Negative weight for drawdown
        };
        
        let score = 0;
        score += (summary.sharpeRatio || 0) * weights.sharpeRatio;
        score += (summary.totalReturn || 0) * weights.totalReturn;
        score += (summary.profitFactor || 0) * weights.profitFactor;
        score += (summary.winRate || 0) * weights.winRate;
        score += (summary.maxDrawdownPercent || 0) * weights.maxDrawdownPercent;
        
        return score;
        
      default:
        return summary[this.config.metric] || 0;
    }
  }

  /**
   * Calculate aggregate statistics across all splits
   * @param {Array} splitResults - Results from each split
   */
  calculateAggregateStats(splitResults) {
    if (splitResults.length === 0) return null;
    
    const testScores = splitResults.map(s => s.testScore);
    const trainScores = splitResults.map(s => s.trainScore);
    
    return {
      avgTrainScore: this.average(trainScores),
      avgTestScore: this.average(testScores),
      stdTrainScore: this.stdDev(trainScores),
      stdTestScore: this.stdDev(testScores),
      minTestScore: Math.min(...testScores),
      maxTestScore: Math.max(...testScores),
      consistency: this.calculateConsistency(testScores)
    };
  }

  /**
   * Calculate average
   * @param {Array} values - Values array
   */
  average(values) {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  /**
   * Calculate standard deviation
   * @param {Array} values - Values array
   */
  stdDev(values) {
    if (values.length < 2) return 0;
    const avg = this.average(values);
    const variance = values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / values.length;
    return Math.sqrt(variance);
  }

  /**
   * Calculate consistency score (lower std dev = more consistent)
   * @param {Array} scores - Test scores
   */
  calculateConsistency(scores) {
    if (scores.length < 2) return 1;
    const avg = this.average(scores);
    const stdDev = this.stdDev(scores);
    return avg > 0 ? Math.max(0, 1 - (stdDev / avg)) : 0;
  }

  /**
   * Generate parameter recommendations
   * @param {Object} results - Optimization results
   */
  generateRecommendations(results) {
    const recommendations = [];
    
    // Check for overfitting
    const avgTrain = results.aggregate?.avgTrainScore || 0;
    const avgTest = results.aggregate?.avgTestScore || 0;
    
    if (avgTrain > avgTest * 1.5) {
      recommendations.push({
        type: 'warning',
        message: 'Possible overfitting detected: training score significantly higher than test score',
        suggestion: 'Reduce parameter complexity or increase training data'
      });
    }
    
    // Check consistency
    const consistency = results.aggregate?.consistency || 0;
    if (consistency < 0.5) {
      recommendations.push({
        type: 'warning',
        message: 'Low consistency across walk-forward splits',
        suggestion: 'Strategy may not be robust to changing market conditions'
      });
    }
    
    // Check for sufficient trades
    const avgTrades = results.splits.reduce((sum, s) => 
      sum + (s.testResult?.totalTrades || 0), 0) / results.splits.length;
    
    if (avgTrades < this.config.minTrades) {
      recommendations.push({
        type: 'info',
        message: `Low trade frequency: ${avgTrades.toFixed(1)} trades per period`,
        suggestion: 'Consider reducing signal thresholds or using shorter timeframes'
      });
    }
    
    return recommendations;
  }

  /**
   * Export results to JSON
   * @param {Object} results - Optimization results
   */
  exportResults(results) {
    return JSON.stringify({
      ...results,
      recommendations: this.generateRecommendations(results),
      config: this.config,
      timestamp: new Date().toISOString()
    }, null, 2);
  }
}

module.exports = StrategyOptimizer;
