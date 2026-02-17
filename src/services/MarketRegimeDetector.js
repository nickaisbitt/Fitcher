const logger = require('../utils/logger');

/**
 * MarketRegimeDetector - Identifies market conditions
 * Returns: trending_up, trending_down, ranging, volatile
 */
class MarketRegimeDetector {
  constructor(options = {}) {
    this.config = {
      adxThreshold: options.adxThreshold || 25,
      volatilityThreshold: options.volatilityThreshold || 0.03,
      ...options
    };
  }

  /**
   * Detect regime from multi-timeframe indicators
   */
  detect(snapshot) {
    const primary = snapshot['1h'] || snapshot['15m'];
    if (!primary || !primary.warmedUp) return 'unknown';

    const alignment = snapshot.trendAlignment;
    const adx = primary.adx || this.approximateADX(primary);
    
    // Check for high volatility
    const atr = primary.atr || (primary.bb ? (primary.bb.upper - primary.bb.lower) / 4 : 0);
    const price = primary.close || primary.price;
    const volatility = atr / price;

    if (volatility > this.config.volatilityThreshold) {
      return 'volatile';
    }

    // Check for trend
    if (adx > this.config.adxThreshold) {
      if (alignment.includes('uptrend')) return 'trending_up';
      if (alignment.includes('downtrend')) return 'trending_down';
    }

    return 'ranging';
  }

  /**
   * Approximate ADX using EMA spread if ADX not calculated
   */
  approximateADX(indicators) {
    if (!indicators.ema12 || !indicators.ema26) return 0;
    const spread = Math.abs(indicators.ema12 - indicators.ema26) / indicators.ema26;
    return spread * 500; // Scaled to ~0-100
  }

  /**
   * Get strategy weights for a regime
   */
  getWeights(regime) {
    switch (regime) {
      case 'trending_up':
        return { momentum: 1.5, meanReversion: 0.5, grid: 0.2 };
      case 'trending_down':
        return { momentum: 1.5, meanReversion: 0.5, grid: 0.2 };
      case 'ranging':
        return { momentum: 0.3, meanReversion: 1.2, grid: 1.5 };
      case 'volatile':
        return { momentum: 0.5, meanReversion: 0.5, grid: 0.5 }; // Reduce all
      default:
        return { momentum: 1.0, meanReversion: 1.0, grid: 1.0 };
    }
  }
}

module.exports = MarketRegimeDetector;
