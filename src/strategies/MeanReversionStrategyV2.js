const logger = require('../utils/logger');
const MultiTimeframeIndicatorState = require('../services/MultiTimeframeIndicatorState');

/**
 * MeanReversionStrategyV2 - Multi-timeframe mean reversion
 * Uses Bollinger Bands + RSI across multiple timeframes
 * Only trades when price is extended and showing reversal signs
 */
class MeanReversionStrategyV2 {
  constructor(config = {}) {
    this.name = 'Mean Reversion v2';
    this.description = 'Multi-timeframe mean reversion with BB + RSI';
    
    this.config = {
      primaryTimeframe: config.primaryTimeframe || '1h',
      timeframes: config.timeframes || ['15m', '1h', '4h'],
      
      // Bollinger Bands
      bbPeriod: config.bbPeriod || 20,
      bbStdDev: config.bbStdDev || 2,
      
      // RSI
      rsiPeriod: config.rsiPeriod || 14,
      rsiOversold: config.rsiOversold || 30,
      rsiOverbought: config.rsiOverbought || 70,
      
      // Entry conditions
      minDistanceFromMean: config.minDistanceFromMean || 1.5, // % from mean
      requireConfirmation: config.requireConfirmation !== false,
      
    // Exit conditions
    stopLoss: config.stopLoss || 0.015,     // 1.5%
    takeProfit: config.takeProfit || 0.03,  // 3% (back to mean)
    stopLossAtrMultiplier: config.stopLossAtrMultiplier || 1.5, // 1.5x ATR for hard stop
    
    // Position sizing
      
      // Position sizing
      basePositionSize: config.basePositionSize || 0.08,
      maxPositionSize: config.maxPositionSize || 0.15,
      
      // Filters
      maxVolatility: config.maxVolatility || 0.08, // Don't trade in very high vol
      
      ...config
    };
    
    this.indicatorStates = new Map();
    this.signals = [];
    this.trades = [];
    this.position = null;
  }

  initializePair(pair) {
    if (!this.indicatorStates.has(pair)) {
      this.indicatorStates.set(pair, new MultiTimeframeIndicatorState(this.config.timeframes));
      logger.info(`MeanReversionStrategyV2 initialized for ${pair}`);
    }
    return this.indicatorStates.get(pair);
  }

  update(candle, pair) {
    const state = this.initializePair(pair);
    state.update(candle);
  }

  async generateSignal(marketData) {
    try {
      const { pair, price, timestamp, indicators } = marketData;
      
      const state = this.initializePair(pair);
      
      // Use provided indicators if available (for tests/legacy compatibility)
      let snapshot;
      if (indicators && (indicators.bb || indicators.rsi)) {
        snapshot = {
          [this.config.primaryTimeframe]: indicators,
          overallWarmedUp: true
        };
      } else {
        snapshot = state.getSnapshot();
      }
      
      if (!snapshot.overallWarmedUp && !indicators) {
        return { action: 'hold', confidence: 0, reason: 'Warming up...', strategy: this.name };
      }

      const primary = snapshot[this.config.primaryTimeframe];
      
      const atr = state.getATR(this.config.primaryTimeframe, 14);
      
      // Check for exit signals if holding position
      if (this.position) {
        // Stop loss
        if (this.position.stopLoss && price <= this.position.stopLoss) {
          return { action: 'sell', confidence: 1.0, reason: 'Stop loss hit', strategy: this.name, pair, price };
        }
        
        // Take profit (back to mean)
        if (price >= primary.bb?.middle) {
          return { action: 'sell', confidence: 0.9, reason: 'Reached mean (take profit)', strategy: this.name, pair, price };
        }
        
        // Trend Exhaustion: RSI crosses 50 from extreme, or overbought
        if (primary.rsi > this.config.rsiOverbought || (primary.rsi > 50 && primary.rsi < 70)) {
          return { action: 'sell', confidence: 0.75, reason: 'RSI exhaustion/overbought', strategy: this.name, pair, price };
        }
      }
      // Take profit (back to mean)
      if (price >= primary.bb?.middle) {
        return { action: 'sell', confidence: 0.9, reason: 'Reached mean (take profit)', strategy: this.name, pair, price };
      }
      // Trend Exhaustion: RSI crosses 50 from extreme, or overbought
      if (primary.rsi > this.config.rsiOverbought || (primary.rsi > 50 && primary.rsi < 70)) {
        return { action: 'sell', confidence: 0.75, reason: 'RSI exhaustion/overbought', strategy: this.name, pair, price };
      }
    }
      // Take profit (back to mean)
      if (price >= primary.bb?.middle) {
        return { action: 'sell', confidence: 0.9, reason: 'Reached mean (take profit)', strategy: this.name, pair, price };
      }
      // Trend Exhaustion: RSI crosses 50 from extreme, or overbought
      if (primary.rsi > this.config.rsiOverbought || (primary.rsi > 50 && primary.rsi < 70)) {
        return { action: 'sell', confidence: 0.75, reason: 'RSI exhaustion/overbought', strategy: this.name, pair, price };
      }
    }

      // Check volatility filter
      const volatility = state.getATR(this.config.primaryTimeframe, 14);
      if (volatility && volatility / price > this.config.maxVolatility) {
        return { 
          action: 'hold', 
          confidence: 0, 
          reason: 'Volatility too high',
          strategy: this.name 
        };
      }

      // Analyze mean reversion conditions
      const analysis = this.analyzeMeanReversion(primary, price);
      
      let action = 'hold';
      let confidence = analysis.confidence;
      let reason = analysis.reason;
      
      // Buy: Price below lower band + RSI oversold
      if (analysis.oversold && analysis.belowBand) {
        action = 'buy';
        
        // Increase confidence with multi-timeframe confirmation
        if (this.config.requireConfirmation) {
          let confirmationCount = 1;
          for (const tf of ['15m', '4h']) {
            if (tf === this.config.primaryTimeframe) continue;
            const tfSnapshot = snapshot[tf];
            if (tfSnapshot?.bb && tfSnapshot?.rsi) {
              const tfAnalysis = this.analyzeMeanReversion(tfSnapshot, price);
              if (tfAnalysis.oversold) confirmationCount++;
            }
          }
          confidence *= (confirmationCount / 2); // Boost confidence with confirmation
        }
      }
      
    // Sell: Price above upper band + RSI overbought (if holding position)
    if (analysis.overbought && analysis.aboveBand) {
      if (this.position) {
        action = 'sell';
        reason = `Overbought signal (${analysis.reason})`;
      } else {
        action = 'hold';
        reason = `Overbought signal (${analysis.reason}) but no position to sell`;
      }
    }
      }

      if (confidence < 0.6) {
        action = 'hold';
      }

      const signal = {
        action,
        confidence,
        reason: analysis.reason,
        strategy: this.name,
        pair,
        price,
        amount: this.calculatePositionSize(confidence),
        timestamp,
        indicators: { primary, bbPosition: analysis.bbPosition, rsi: primary.rsi },
        stopLoss: price * (1 - this.config.stopLoss),
        takeProfit: primary.bb?.middle || price * (1 + this.config.takeProfit)
      };

      this.signals.push(signal);
      if (this.signals.length > 1000) this.signals.shift();

      return signal;
      
    } catch (error) {
      logger.error('MeanReversionStrategyV2 error:', error);
      return { action: 'hold', confidence: 0, reason: 'Error', strategy: this.name };
    }
  }

  analyzeMeanReversion(indicators, price) {
    if (!indicators.bb || !indicators.rsi) {
      return { 
        oversold: false, 
        overbought: false, 
        confidence: 0,
        reason: 'Missing indicators'
      };
    }

    const bb = indicators.bb;
    const rsi = indicators.rsi;
    
    // Calculate position within Bollinger Bands
    const bandRange = bb.upper - bb.lower;
    const bbPosition = bandRange > 0 ? (price - bb.lower) / bandRange : 0.5;
    
    // Distance from middle band
    const distanceFromMean = Math.abs(price - bb.middle) / bb.middle;
    
    const oversold = rsi < this.config.rsiOversold && price < bb.lower;
    const overbought = rsi > this.config.rsiOverbought && price > bb.upper;
    
    let confidence = 0;
    const reasons = [];
    
    if (oversold) {
      confidence = (this.config.rsiOversold - rsi) / this.config.rsiOversold;
      confidence *= distanceFromMean / (this.config.bbStdDev * 0.01);
      reasons.push(`RSI ${rsi.toFixed(1)} oversold, below BB`);
    } else if (overbought) {
      confidence = (rsi - this.config.rsiOverbought) / (100 - this.config.rsiOverbought);
      reasons.push(`RSI ${rsi.toFixed(1)} overbought, above BB`);
    }
    
    return {
      oversold,
      overbought,
      belowBand: price < bb.lower,
      aboveBand: price > bb.upper,
      bbPosition,
      distanceFromMean,
      confidence: Math.min(confidence, 0.95),
      reason: reasons.join(', ')
    };
  }

  calculatePositionSize(confidence) {
    return Math.min(this.config.basePositionSize * confidence, this.config.maxPositionSize);
  }

  getConfig() {
    return { ...this.config };
  }

  getPerformance() {
    return {
      name: this.name,
      totalSignals: this.signals.length,
      avgConfidence: this.signals.length > 0 
        ? this.signals.reduce((s, sig) => s + sig.confidence, 0) / this.signals.length 
        : 0
    };
  }

  reset() {
    this.indicatorStates.clear();
    this.signals = [];
  }
}

module.exports = MeanReversionStrategyV2;
