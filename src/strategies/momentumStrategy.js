const logger = require('../utils/logger');

/**
 * MomentumStrategy - EMA Cross + MACD strategy (spot-only)
 *
 * Entry: EMA12 crosses above EMA26 with positive MACD histogram and
 *        sufficient trend strength.
 * Exit:  Trailing stop, or bearish EMA cross + MACD reversal.
 *
 * Spot-only: never issues a sell unless it already holds a long position.
 * Uses real MACD values from IndicatorState (line/signal/histogram),
 * NOT the old fake "signalLine = macdLine * 0.8" hack.
 */
class MomentumStrategy {
  constructor(config = {}) {
    this.config = {
      fastEma: 12,
      slowEma: 26,
      signalEma: 9,
      macdThreshold: 0,
      positionSize: 0.15,
      trailingStopPercent: 3,
      minTrendStrength: 0.5,
      ...config
    };

    this.name = 'Momentum (EMA + MACD)';
    this.position = null;
    this.highestPrice = 0;
  }

  /**
   * Generate trading signal
   * @param {Object} marketData - { price, indicators, recentCandles, ... }
   *   indicators comes from IndicatorState.getSnapshot():
   *     { ema12, ema26, rsi, bb, macd: { line, signal, histogram }, warmedUp }
   */
  async generateSignal(marketData) {
    try {
      const { price, indicators } = marketData;

      // Need EMA and MACD to be fully warmed up
      if (!indicators?.ema12 || !indicators?.ema26 || !indicators?.macd) {
        return { action: 'hold', confidence: 0, reason: 'Indicators not warmed up' };
      }

      const macd = indicators.macd;

      // MACD signal line may still be warming up (needs 9 periods after EMA26)
      if (macd.histogram === null || macd.signal === null) {
        return { action: 'hold', confidence: 0, reason: 'MACD signal line warming up' };
      }

      // --- Exit logic first (if holding) ---
      if (this.position) {
        return this.checkExitSignals(marketData, macd);
      }

      // --- Entry logic (long only, spot mode) ---
      const ema12 = indicators.ema12;
      const ema26 = indicators.ema26;

      // Bullish: EMA12 above EMA26 + MACD histogram positive
      if (ema12 > ema26 && macd.histogram > this.config.macdThreshold) {
        const trendStrength = this.calculateTrendStrength(marketData);

        if (trendStrength >= this.config.minTrendStrength) {
          const amount = this.calculatePositionSize(marketData, trendStrength);
          const trailingStop = price * (1 - this.config.trailingStopPercent / 100);

          this.recordEntry(amount, price, trailingStop);

          return {
            action: 'buy',
            confidence: this.calculateConfidence(macd, trendStrength),
            reason: `Bullish EMA cross with MACD hist ${macd.histogram.toFixed(4)}, trend ${trendStrength.toFixed(2)}`,
            price,
            amount,
            trailingStop
          };
        }
      }

      // NOTE: bearish crossover in old code emitted a 'sell' / short signal.
      // In spot-only mode we cannot short, so we simply hold if not in position.

      return { action: 'hold', confidence: 0, reason: 'No momentum signal' };

    } catch (error) {
      logger.error('Momentum strategy error:', error);
      return { action: 'hold', confidence: 0, reason: 'Strategy error' };
    }
  }

  /**
   * Calculate trend strength from recent candles
   */
  calculateTrendStrength(marketData) {
    const { recentCandles } = marketData;

    if (!recentCandles || recentCandles.length < 10) {
      return 0;
    }

    let upMoves = 0;
    let downMoves = 0;

    for (let i = 1; i < recentCandles.length; i++) {
      if (recentCandles[i].close > recentCandles[i - 1].close) upMoves++;
      else if (recentCandles[i].close < recentCandles[i - 1].close) downMoves++;
    }

    const totalMoves = upMoves + downMoves;
    if (totalMoves === 0) return 0;

    return Math.abs(upMoves - downMoves) / totalMoves;
  }

  /**
   * Check for exit signals when holding a long position
   */
  checkExitSignals(marketData, macd) {
    const { price, indicators } = marketData;

    // Update trailing stop
    if (price > this.highestPrice) {
      this.highestPrice = price;
      this.position.trailingStop = price * (1 - this.config.trailingStopPercent / 100);
    }

    // Trailing stop hit
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

    // Bearish EMA cross + negative MACD histogram → close long
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

    return { action: 'hold', confidence: 0, reason: 'Holding position' };
  }

  /**
   * Calculate signal confidence (0-1)
   */
  calculateConfidence(macd, trendStrength) {
    let confidence = 0.5;

    // MACD histogram magnitude
    const macdStrength = Math.min(Math.abs(macd.histogram) * 100, 0.3);
    confidence += macdStrength;

    // Trend strength
    confidence += trendStrength * 0.2;

    return Math.min(confidence, 1.0);
  }

  /**
   * Scale position size with trend strength
   */
  calculatePositionSize(marketData, trendStrength) {
    const rawSize = this.config.positionSize * (0.5 + trendStrength * 0.5);
    return Math.min(rawSize, 0.99); // Never exceed 99% of balance
  }

  /**
   * Record long entry
   */
  recordEntry(amount, price, trailingStop) {
    this.position = {
      side: 'long',
      amount,
      entryPrice: price,
      trailingStop,
      entryTime: Date.now()
    };
    this.highestPrice = price;
  }

  getConfig() {
    return { name: this.name, ...this.config };
  }

  updateParams(params) {
    Object.assign(this.config, params);
    // Reset position state when params change (optimizer calls this between runs)
    this.position = null;
    this.highestPrice = 0;
  }

  /**
   * Reset strategy state (called between backtest runs)
   */
  reset() {
    this.position = null;
    this.highestPrice = 0;
  }
}

module.exports = MomentumStrategy;
