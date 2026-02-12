const logger = require('../utils/logger');

/**
 * MeanReversionStrategy - Bollinger Bands + RSI strategy (spot-only)
 *
 * Entry (long): Price below lower Bollinger Band + RSI oversold.
 * Exit (sell):  Price reverts to middle band (take profit) or stop loss.
 *
 * Spot-only: the old "short" entry when overbought is removed because
 * the backtest engine runs in spot mode -- you can't sell what you don't hold.
 * Instead, when overbought while already holding, we treat it as an exit signal.
 *
 * Uses indicators from IndicatorState.getSnapshot():
 *   { bb: { upper, middle, lower }, rsi: number, ... }
 */
class MeanReversionStrategy {
  constructor(config = {}) {
    this.config = {
      bbPeriod: config.bbPeriod || 20,
      bbStdDev: config.bbStdDev || 2,
      rsiPeriod: config.rsiPeriod || 14,
      rsiOverbought: config.rsiOverbought || 70,
      rsiOversold: config.rsiOversold || 30,
      positionSize: config.positionSize || 0.1, // fraction of balance
      takeProfitAtMean: config.takeProfitAtMean !== false,
      stopLossPercent: config.stopLossPercent || 2,
      ...config
    };

    this.name = 'Mean Reversion (Bollinger + RSI)';
    this.position = null;
  }

  /**
   * Generate trading signal
   */
  async generateSignal(marketData) {
    try {
      const { price, indicators } = marketData;

      if (!indicators?.bb || indicators.rsi === null || indicators.rsi === undefined) {
        return { action: 'hold', confidence: 0, reason: 'Indicators not available' };
      }

      const { bb, rsi } = indicators;

      // --- Exit logic first (if holding a long position) ---
      if (this.position) {
        return this.checkExitSignals(marketData);
      }

      // --- Entry: long when oversold ---
      // Price below lower band + RSI oversold
      if (price < bb.lower && rsi < this.config.rsiOversold) {
        const amount = this.config.positionSize;
        const stopLoss = price * (1 - this.config.stopLossPercent / 100);

        this.recordEntry(amount, price, stopLoss);

        return {
          action: 'buy',
          confidence: this.calculateConfidence(rsi, price, bb.lower, 'oversold'),
          reason: `Price (${price.toFixed(2)}) below lower band (${bb.lower.toFixed(2)}) with RSI ${rsi.toFixed(2)}`,
          price,
          amount,
          stopLoss,
          takeProfit: this.config.takeProfitAtMean ? bb.middle : bb.upper
        };
      }

      // NOTE: old code opened a short here when overbought. In spot mode we can't
      // short, so if we're not holding we simply stay out.

      return { action: 'hold', confidence: 0, reason: 'No mean reversion signal' };

    } catch (error) {
      logger.error('Mean reversion strategy error:', error);
      return { action: 'hold', confidence: 0, reason: 'Strategy error' };
    }
  }

  /**
   * Check exit signals for a long position
   */
  checkExitSignals(marketData) {
    const { price, indicators } = marketData;
    const { bb, rsi } = indicators;

    // Take profit: price reverts to middle band
    if (this.config.takeProfitAtMean && price >= bb.middle) {
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

    // Overbought exit: price above upper band + RSI overbought → sell holdings
    if (price > bb.upper && rsi > this.config.rsiOverbought) {
      const amount = this.position.amount;
      this.position = null;
      return {
        action: 'sell',
        confidence: 0.9,
        reason: `Overbought exit: price (${price.toFixed(2)}) above upper band with RSI ${rsi.toFixed(2)}`,
        price,
        amount
      };
    }

    // Stop loss
    if (this.position.stopLoss && price <= this.position.stopLoss) {
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

    return { action: 'hold', confidence: 0, reason: 'Holding position' };
  }

  /**
   * Calculate signal confidence (0-1)
   */
  calculateConfidence(rsi, price, band, condition) {
    let confidence = 0.5;

    if (condition === 'overbought') {
      confidence += (rsi - this.config.rsiOverbought) / 30 * 0.3;
    } else {
      confidence += (this.config.rsiOversold - rsi) / 30 * 0.3;
    }

    const distance = Math.abs(price - band) / band;
    confidence += Math.min(distance * 5, 0.2);

    return Math.min(Math.max(confidence, 0), 1.0);
  }

  recordEntry(amount, price, stopLoss) {
    this.position = {
      side: 'long',
      amount,
      entryPrice: price,
      stopLoss,
      entryTime: Date.now()
    };
  }

  getConfig() {
    return { name: this.name, ...this.config };
  }

  updateParams(params) {
    Object.assign(this.config, params);
    // Reset position between optimizer runs
    this.position = null;
  }

  reset() {
    this.position = null;
  }
}

module.exports = MeanReversionStrategy;
