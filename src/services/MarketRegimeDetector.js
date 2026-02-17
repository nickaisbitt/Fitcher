const logger = require('../utils/logger');

/**
 * MarketRegimeDetector - Identifies market conditions
 * Returns: trending_up, trending_down, ranging, volatile
 */
class MarketRegimeDetector {
  constructor(config = {}) {
    this.config = {
      adxThreshold: config.adxThreshold || 25,
      volatilityThreshold: config.volatilityThreshold || 0.03,
      ...config
    };
    this.trendState = new Map(); // Stores last known trend alignment
  }

  /**
   * Analyze trend alignment across timeframes
   */
  analyzeTrendAlignment(snapshot) {
    let bullishCount = 0;
    let bearishCount = 0;
    let strongBullish = 0;
    let strongBearish = 0;
    
    // Only check timeframes we know have indicators calculated
    const timeframes = Object.keys(snapshot).filter(k => k.endsWith('m') || k.endsWith('d'));
    
    for (const tf of timeframes) {
      const indicators = snapshot[tf];
      if (!indicators || !indicators.warmedUp) continue;
      
      // Check EMA alignment
      if (indicators.ema12 && indicators.ema26) {
        if (indicators.ema12 > indicators.ema26) {
          // Bullish
          const spread = (indicators.ema12 - indicators.ema26) / indicators.ema26;
          if (spread > 0.01) strongBullish++;
          else bullishCount++;
        } else {
          // Bearish
          const spread = (indicators.ema26 - indicators.ema12) / indicators.ema26;
          if (spread > 0.01) strongBearish++;
          else bearishCount++;
        }
      }
    }
    
    const totalBullish = bullishCount + (strongBullish * 2);
    const totalBearish = bearishCount + (strongBearish * 2);
    const score = totalBullish - totalBearish;
    
    let direction = 'neutral';
    if (score >= 3) direction = 'strong_uptrend';
    else if (score >= 1) direction = 'uptrend';
    else if (score <= -3) direction = 'strong_downtrend';
    else if (score <= -1) direction = 'downtrend';
    
    // Store for later use by other services
    this.trendState.set('global', { score, direction });
    
    return { score, direction };
  }

  /**
   * Detect regime based on trend and volatility
   */
  detect(snapshot) {
    const primary = snapshot['1h'] || snapshot['15m'];
    if (!primary || !primary.warmedUp) return 'unknown';

    const alignment = this.analyzeTrendAlignment(snapshot).direction;
    const adx = this.approximateADX(primary);
    
    // Check for high volatility
    const atr = primary.atr || (primary.bb ? (primary.bb.upper - primary.bb.lower) / 4 : 0);
    const price = primary.close || primary.price;
    const volatility = atr && price ? atr / price : 0.02;

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
