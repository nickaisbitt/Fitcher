const logger = require('../utils/logger');

/**
 * MeanReversionStrategy - Bollinger Bands + RSI strategy
 * Enters when price exceeds bands with RSI confirmation
 * Exits at mean reversion
 */
class MeanReversionStrategy {
  constructor(config = {}) {
    this.config = {
      bbPeriod: config.bbPeriod || 20,
      bbStdDev: config.bbStdDev || 2,
      rsiPeriod: config.rsiPeriod || 14,
      rsiOverbought: config.rsiOverbought || 70,
      rsiOversold: config.rsiOversold || 30,
      positionSize: config.positionSize || 0.1, // 10% of balance
      takeProfitAtMean: config.takeProfitAtMean !== false,
      stopLossPercent: config.stopLossPercent || 2,
      ...config
    };
    
    this.name = 'Mean Reversion (Bollinger + RSI)';
    this.position = null; // Current position
  }

  /**
   * Generate trading signal
   * @param {Object} marketData - Market data with indicators
   */
  async generateSignal(marketData) {
    try {
      const { price, indicators } = marketData;
      
      if (!indicators?.bb || !indicators?.rsi) {
        return {
          action: 'hold',
          confidence: 0,
          reason: 'Indicators not available'
        };
      }
      
      const { bb, rsi } = indicators;
      
      // Check for exit signal first if in position
      if (this.position) {
        return this.checkExitSignals(marketData);
      }
      
      // Check for entry signals
      // Short signal: Price above upper band + RSI overbought
      if (price > bb.upper && rsi > this.config.rsiOverbought) {
        const amount = this.calculatePositionSize(marketData);
        const signal = {
          action: 'sell',
          confidence: this.calculateConfidence(rsi, price, bb.upper, 'overbought'),
          reason: `Price (${price.toFixed(2)}) above upper band (${bb.upper.toFixed(2)}) with RSI ${rsi.toFixed(2)}`,
          price,
          amount,
          stopLoss: price * (1 + this.config.stopLossPercent / 100),
          takeProfit: this.config.takeProfitAtMean ? bb.middle : bb.lower
        };

        this.recordEntry('short', amount, price, signal.stopLoss);
        return signal;
      }
      
      // Long signal: Price below lower band + RSI oversold
      if (price < bb.lower && rsi < this.config.rsiOversold) {
        const amount = this.calculatePositionSize(marketData);
        const signal = {
          action: 'buy',
          confidence: this.calculateConfidence(rsi, price, bb.lower, 'oversold'),
          reason: `Price (${price.toFixed(2)}) below lower band (${bb.lower.toFixed(2)}) with RSI ${rsi.toFixed(2)}`,
          price,
          amount,
          stopLoss: price * (1 - this.config.stopLossPercent / 100),
          takeProfit: this.config.takeProfitAtMean ? bb.middle : bb.upper
        };

        this.recordEntry('long', amount, price, signal.stopLoss);
        return signal;
      }
      
      return {
        action: 'hold',
        confidence: 0,
        reason: 'No mean reversion signal'
      };
      
    } catch (error) {
      logger.error('Mean reversion strategy error:', error);
      return {
        action: 'hold',
        confidence: 0,
        reason: 'Strategy error'
      };
    }
  }

  /**
   * Check for exit signals when in position
   * @param {Object} marketData - Market data
   */
  checkExitSignals(marketData) {
    const { price, indicators } = marketData;
    const { bb } = indicators;
    
    // Exit at middle band (mean reversion)
    if (this.config.takeProfitAtMean) {
      if (this.position.side === 'long' && price >= bb.middle) {
        const amount = this.position.amount;
        this.position = null;
        return {
          action: 'sell',
          confidence: 0.8,
          reason: `Mean reversion target reached at ${price.toFixed(2)}`,
          price,
          amount
        };
      }
      
      if (this.position.side === 'short' && price <= bb.middle) {
        const amount = this.position.amount;
        this.position = null;
        return {
          action: 'buy',
          confidence: 0.8,
          reason: `Mean reversion target reached at ${price.toFixed(2)}`,
          price,
          amount
        };
      }
    }
    
    // Stop loss check
    if (this.position.stopLoss) {
      if (this.position.side === 'long' && price <= this.position.stopLoss) {
        const amount = this.position.amount;
        this.position = null;
        return {
          action: 'sell',
          confidence: 1.0,
          reason: `Stop loss triggered at ${price.toFixed(2)}`,
          price,
          amount
        };
      }
      
      if (this.position.side === 'short' && price >= this.position.stopLoss) {
        const amount = this.position.amount;
        this.position = null;
        return {
          action: 'buy',
          confidence: 1.0,
          reason: `Stop loss triggered at ${price.toFixed(2)}`,
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
   * Calculate signal confidence (0-1)
   * @param {number} rsi - RSI value
   * @param {number} price - Current price
   * @param {number} band - Band price
   * @param {string} condition - 'overbought' or 'oversold'
   */
  calculateConfidence(rsi, price, band, condition) {
    let confidence = 0.5;
    
    // RSI extremity
    if (condition === 'overbought') {
      confidence += (rsi - this.config.rsiOverbought) / 30 * 0.3;
    } else {
      confidence += (this.config.rsiOversold - rsi) / 30 * 0.3;
    }
    
    // Distance from band
    const distance = Math.abs(price - band) / band;
    confidence += Math.min(distance * 5, 0.2);
    
    return Math.min(confidence, 1.0);
  }

  /**
   * Calculate position size
   * @param {Object} marketData - Market data
   */
  calculatePositionSize(marketData) {
    // Simplified: return fixed percentage
    // In production, this would consider volatility, portfolio value, etc.
    return this.config.positionSize;
  }

  /**
   * Record position entry
   * @param {string} side - 'long' or 'short'
   * @param {number} amount - Position amount
   * @param {number} price - Entry price
   * @param {number} stopLoss - Stop loss price
   */
  recordEntry(side, amount, price, stopLoss) {
    this.position = {
      side,
      amount,
      entryPrice: price,
      stopLoss,
      entryTime: Date.now()
    };
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
    logger.info('Mean reversion strategy parameters updated:', params);
  }
}

module.exports = MeanReversionStrategy;
