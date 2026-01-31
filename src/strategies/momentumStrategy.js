const logger = require('../utils/logger');

/**
 * MomentumStrategy - EMA Cross + MACD strategy
 * Enters on trend confirmation with MACD momentum
 * Uses trailing stop to lock in profits
 */
class MomentumStrategy {
  constructor(config = {}) {
    this.config = {
      fastEma: config.fastEma || 12,
      slowEma: config.slowEma || 26,
      signalEma: config.signalEma || 9,
      macdThreshold: config.macdThreshold || 0,
      positionSize: config.positionSize || 0.15,
      trailingStopPercent: config.trailingStopPercent || 3,
      minTrendStrength: config.minTrendStrength || 0.5,
      ...config
    };
    
    this.name = 'Momentum (EMA + MACD)';
    this.position = null;
    this.highestPrice = 0;
    this.lowestPrice = Infinity;
  }

  /**
   * Generate trading signal
   * @param {Object} marketData - Market data with indicators
   */
  async generateSignal(marketData) {
    try {
      const { price, indicators } = marketData;
      
      if (!indicators?.ema12 || !indicators?.ema26) {
        return {
          action: 'hold',
          confidence: 0,
          reason: 'EMA indicators not available'
        };
      }
      
      // Calculate MACD
      const macd = this.calculateMACD(indicators);
      
      // Check for exit signals first
      if (this.position) {
        return this.checkExitSignals(marketData, macd);
      }
      
      // Check for entry signals
      const ema12 = indicators.ema12;
      const ema26 = indicators.ema26;
      
      // Bullish crossover: EMA12 crosses above EMA26 + MACD positive
      if (ema12 > ema26 && macd.histogram > this.config.macdThreshold) {
        const trendStrength = this.calculateTrendStrength(marketData);
        
        if (trendStrength >= this.config.minTrendStrength) {
          const amount = this.calculatePositionSize(marketData, trendStrength);
          const signal = {
            action: 'buy',
            confidence: this.calculateConfidence(macd, trendStrength, 'bullish'),
            reason: `Bullish EMA cross with MACD ${macd.histogram.toFixed(4)}, trend strength ${trendStrength.toFixed(2)}`,
            price,
            amount,
            trailingStop: price * (1 - this.config.trailingStopPercent / 100)
          };

          this.recordEntry('long', amount, price, signal.trailingStop);
          return signal;
        }
      }
      
      // Bearish crossover: EMA12 crosses below EMA26 + MACD negative
      if (ema12 < ema26 && macd.histogram < -this.config.macdThreshold) {
        const trendStrength = this.calculateTrendStrength(marketData);
        
        if (trendStrength >= this.config.minTrendStrength) {
          const amount = this.calculatePositionSize(marketData, trendStrength);
          const signal = {
            action: 'sell',
            confidence: this.calculateConfidence(macd, trendStrength, 'bearish'),
            reason: `Bearish EMA cross with MACD ${macd.histogram.toFixed(4)}, trend strength ${trendStrength.toFixed(2)}`,
            price,
            amount,
            trailingStop: price * (1 + this.config.trailingStopPercent / 100)
          };

          this.recordEntry('short', amount, price, signal.trailingStop);
          return signal;
        }
      }
      
      return {
        action: 'hold',
        confidence: 0,
        reason: 'No momentum signal'
      };
      
    } catch (error) {
      logger.error('Momentum strategy error:', error);
      return {
        action: 'hold',
        confidence: 0,
        reason: 'Strategy error'
      };
    }
  }

  /**
   * Calculate MACD from EMAs
   * @param {Object} indicators - Technical indicators
   */
  calculateMACD(indicators) {
    const macdLine = indicators.ema12 - indicators.ema26;
    
    // Simplified signal line (would need more data for accurate calculation)
    const signalLine = macdLine * 0.8; // Approximation
    const histogram = macdLine - signalLine;
    
    return {
      line: macdLine,
      signal: signalLine,
      histogram
    };
  }

  /**
   * Calculate trend strength
   * @param {Object} marketData - Market data
   */
  calculateTrendStrength(marketData) {
    const { recentCandles } = marketData;
    
    if (!recentCandles || recentCandles.length < 10) {
      return 0;
    }
    
    // Calculate directional movement
    let upMoves = 0;
    let downMoves = 0;
    
    for (let i = 1; i < recentCandles.length; i++) {
      const prev = recentCandles[i - 1];
      const curr = recentCandles[i];
      
      if (curr.close > prev.close) upMoves++;
      else if (curr.close < prev.close) downMoves++;
    }
    
    const totalMoves = upMoves + downMoves;
    if (totalMoves === 0) return 0;
    
    // Trend strength is the ratio of dominant direction
    return Math.abs(upMoves - downMoves) / totalMoves;
  }

  /**
   * Check for exit signals
   * @param {Object} marketData - Market data
   * @param {Object} macd - MACD values
   */
  checkExitSignals(marketData, macd) {
    const { price, indicators } = marketData;
    
    // Update trailing stop
    if (this.position.side === 'long') {
      if (price > this.highestPrice) {
        this.highestPrice = price;
        this.position.trailingStop = price * (1 - this.config.trailingStopPercent / 100);
      }
      
      // Check trailing stop
      if (price <= this.position.trailingStop) {
        const amount = this.position.amount;
        this.position = null;
        this.highestPrice = 0;
        return {
          action: 'sell',
          confidence: 1.0,
          reason: `Trailing stop triggered at ${price.toFixed(2)}`,
          price,
          amount
        };
      }
      
      // Exit on MACD bearish crossover
      if (indicators.ema12 < indicators.ema26 && macd.histogram < 0) {
        const amount = this.position.amount;
        this.position = null;
        this.highestPrice = 0;
        return {
          action: 'sell',
          confidence: 0.8,
          reason: `MACD bearish crossover at ${price.toFixed(2)}`,
          price,
          amount
        };
      }
    } else if (this.position.side === 'short') {
      if (price < this.lowestPrice) {
        this.lowestPrice = price;
        this.position.trailingStop = price * (1 + this.config.trailingStopPercent / 100);
      }
      
      // Check trailing stop
      if (price >= this.position.trailingStop) {
        const amount = this.position.amount;
        this.position = null;
        this.lowestPrice = Infinity;
        return {
          action: 'buy',
          confidence: 1.0,
          reason: `Trailing stop triggered at ${price.toFixed(2)}`,
          price,
          amount
        };
      }
      
      // Exit on MACD bullish crossover
      if (indicators.ema12 > indicators.ema26 && macd.histogram > 0) {
        const amount = this.position.amount;
        this.position = null;
        this.lowestPrice = Infinity;
        return {
          action: 'buy',
          confidence: 0.8,
          reason: `MACD bullish crossover at ${price.toFixed(2)}`,
          price,
          amount
        };
      }
    }
    
    return {
      action: 'hold',
      confidence: 0,
      reason: 'Holding position'
    };
  }

  /**
   * Calculate signal confidence
   * @param {Object} macd - MACD values
   * @param {number} trendStrength - Trend strength
   * @param {string} direction - 'bullish' or 'bearish'
   */
  calculateConfidence(macd, trendStrength, direction) {
    let confidence = 0.5;
    
    // MACD histogram strength
    const macdStrength = Math.min(Math.abs(macd.histogram) * 100, 0.3);
    confidence += macdStrength;
    
    // Trend strength
    confidence += trendStrength * 0.2;
    
    return Math.min(confidence, 1.0);
  }

  /**
   * Calculate position size based on trend strength
   * @param {Object} marketData - Market data
   * @param {number} trendStrength - Trend strength
   */
  calculatePositionSize(marketData, trendStrength) {
    // Scale position size with trend strength
    return this.config.positionSize * (0.5 + trendStrength * 0.5);
  }

  /**
   * Record position entry
   * @param {string} side - 'long' or 'short'
   * @param {number} amount - Position amount
   * @param {number} price - Entry price
   * @param {number} trailingStop - Initial trailing stop
   */
  recordEntry(side, amount, price, trailingStop) {
    this.position = {
      side,
      amount,
      entryPrice: price,
      trailingStop,
      entryTime: Date.now()
    };
    
    if (side === 'long') {
      this.highestPrice = price;
    } else {
      this.lowestPrice = price;
    }
  }

  /**
   * Get strategy configuration
   */
  getConfig() {
    return {
      name: this.name,
      ...this.config
    };
  }

  /**
   * Update strategy parameters
   * @param {Object} params - New parameters
   */
  updateParams(params) {
    Object.assign(this.config, params);
    logger.info('Momentum strategy parameters updated:', params);
  }
}

module.exports = MomentumStrategy;
