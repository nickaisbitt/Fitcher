const IndicatorState = require('./IndicatorState');
const logger = require('../utils/logger');

/**
 * MultiTimeframeIndicatorState - Manages technical indicators across multiple timeframes
 * Supports: 15m, 1h, 4h, 1d
 * Each timeframe maintains its own IndicatorState for accurate calculations
 */
class MultiTimeframeIndicatorState {
  constructor(timeframes = ['15m', '1h', '4h', '1d']) {
    this.timeframes = timeframes;
    this.states = {};
    this.candleBuffers = {}; // Buffer candles for each timeframe
    
    // Initialize state for each timeframe
    for (const tf of timeframes) {
      this.states[tf] = new IndicatorState();
      this.candleBuffers[tf] = [];
    }
    
    // Conversion: how many 15m candles in each timeframe
    this.timeframeMultipliers = {
      '15m': 1,
      '1h': 4,    // 4 x 15m = 1h
      '4h': 16,   // 16 x 15m = 4h
      '1d': 96    // 96 x 15m = 1d
    };
    
    this.candlesProcessed = 0;
  }

  /**
   * Update with a new candle (assumed to be base timeframe, e.g., 15m)
   * Automatically aggregates and updates higher timeframes
   * @param {Object} candle - { timestamp, open, high, low, close, volume }
   */
  update(candle) {
    this.candlesProcessed++;
    
    // Always update the base timeframe (15m)
    this.states['15m'].update(candle.close);
    this.candleBuffers['15m'].push(candle);
    
    // Check if we need to update higher timeframes
    for (const tf of this.timeframes) {
      if (tf === '15m') continue;
      
      const multiplier = this.timeframeMultipliers[tf];
      
      // Check if we have enough candles to form a complete higher timeframe candle
      if (this.candlesProcessed % multiplier === 0) {
        // Build higher timeframe candle from buffer
        const higherTfCandle = this.buildHigherTimeframeCandle(tf, multiplier);
        if (higherTfCandle) {
          this.states[tf].update(higherTfCandle.close);
          this.candleBuffers[tf].push(higherTfCandle);
          
          // Keep buffer size manageable (last 100 candles)
          if (this.candleBuffers[tf].length > 100) {
            this.candleBuffers[tf].shift();
          }
        }
      }
    }
    
    // Keep 15m buffer manageable
    if (this.candleBuffers['15m'].length > 100) {
      this.candleBuffers['15m'].shift();
    }
  }

  /**
   * Build a higher timeframe candle from recent base candles
   */
  buildHigherTimeframeCandle(timeframe, multiplier) {
    const baseCandles = this.candleBuffers['15m'];
    if (baseCandles.length < multiplier) return null;
    
    const recentCandles = baseCandles.slice(-multiplier);
    
    return {
      timestamp: recentCandles[recentCandles.length - 1].timestamp,
      open: recentCandles[0].open,
      high: Math.max(...recentCandles.map(c => c.high)),
      low: Math.min(...recentCandles.map(c => c.low)),
      close: recentCandles[recentCandles.length - 1].close,
      volume: recentCandles.reduce((sum, c) => sum + (c.volume || 0), 0)
    };
  }

  /**
   * Get indicator snapshot for all timeframes
   * @returns {Object} - Indicators for each timeframe
   */
  getSnapshot() {
    const snapshot = {};
    
    for (const tf of this.timeframes) {
      snapshot[tf] = this.states[tf].getSnapshot();
    }
    
    // Add trend alignment analysis
    snapshot.trendAlignment = this.analyzeTrendAlignment(snapshot);
    snapshot.overallWarmedUp = this.isWarmedUp();
    
    return snapshot;
  }

  /**
   * Get snapshot for specific timeframe
   */
  getTimeframeSnapshot(timeframe) {
    if (!this.states[timeframe]) {
      throw new Error(`Unknown timeframe: ${timeframe}`);
    }
    return this.states[timeframe].getSnapshot();
  }

  /**
   * Analyze trend alignment across timeframes
   * Returns: strong_uptrend | uptrend | ranging | downtrend | strong_downtrend
   */
  analyzeTrendAlignment(snapshot) {
    const trends = {};
    let uptrendCount = 0;
    let downtrendCount = 0;
    let rangingCount = 0;
    let validTimeframes = 0;
    
    for (const tf of this.timeframes) {
      const state = snapshot[tf];
      if (!state || !state.warmedUp) continue;
      
      validTimeframes++;
      
      // Determine trend for this timeframe
      const trend = this.calculateTrend(state);
      trends[tf] = trend;
      
      if (trend === 'strong_uptrend') uptrendCount += 2;
      else if (trend === 'uptrend') uptrendCount += 1;
      else if (trend === 'strong_downtrend') downtrendCount += 2;
      else if (trend === 'downtrend') downtrendCount += 1;
      else rangingCount += 1;
    }
    
    if (validTimeframes === 0) return 'unknown';
    
    // Calculate overall alignment
    const trendScore = uptrendCount - downtrendCount;
    const maxScore = validTimeframes * 2;
    
    if (trendScore >= maxScore * 0.6) return 'strong_uptrend';
    if (trendScore >= maxScore * 0.2) return 'uptrend';
    if (trendScore <= -maxScore * 0.6) return 'strong_downtrend';
    if (trendScore <= -maxScore * 0.2) return 'downtrend';
    return 'ranging';
  }

  /**
   * Calculate trend for a single timeframe's indicators
   */
  calculateTrend(state) {
    if (!state.ema12 || !state.ema26) return 'unknown';
    
    const emaDiff = state.ema12 - state.ema26;
    const emaDiffPct = Math.abs(emaDiff) / state.ema26;
    
    // Check EMA alignment
    const emaBullish = state.ema12 > state.ema26;
    const smaBullish = state.sma20 > state.sma50;
    
    // MACD confirmation
    const macdBullish = state.macd && state.macd.histogram > 0;
    
    // RSI context
    const rsiBullish = state.rsi && state.rsi > 50 && state.rsi < 80;
    const rsiBearish = state.rsi && state.rsi < 50 && state.rsi > 20;
    
    let bullishSignals = 0;
    if (emaBullish) bullishSignals++;
    if (smaBullish) bullishSignals++;
    if (macdBullish) bullishSignals++;
    if (rsiBullish) bullishSignals++;
    
    let bearishSignals = 0;
    if (!emaBullish) bearishSignals++;
    if (!smaBullish) bearishSignals++;
    if (!macdBullish) bearishSignals++;
    if (rsiBearish) bearishSignals++;
    
    // Strong trend requires both EMA and at least 2 other confirmations
    if (emaBullish && bullishSignals >= 3 && emaDiffPct > 0.01) {
      return 'strong_uptrend';
    }
    if (!emaBullish && bearishSignals >= 3 && emaDiffPct > 0.01) {
      return 'strong_downtrend';
    }
    if (bullishSignals >= 2) return 'uptrend';
    if (bearishSignals >= 2) return 'downtrend';
    
    return 'ranging';
  }

  /**
   * Check if all timeframes are warmed up
   */
  isWarmedUp() {
    // Require most configured timeframes to be warmed.
    // For full 4TF mode this is 3+, and for reduced modes (e.g. 15m+1h)
    // this scales down so warmup can actually complete.
    let warmedUpCount = 0;
    for (const tf of this.timeframes) {
      if (this.states[tf].getSnapshot().warmedUp) {
        warmedUpCount++;
      }
    }
    const required = Math.min(3, this.timeframes.length);
    return warmedUpCount >= required;
  }

  /**
   * Get the last N candles for a timeframe
   */
  getCandles(timeframe, count = 10) {
    const buffer = this.candleBuffers[timeframe];
    if (!buffer) return [];
    return buffer.slice(-count);
  }

  /**
   * Get current price (from most recent candle)
   */
  getCurrentPrice() {
    const baseCandles = this.candleBuffers['15m'];
    if (baseCandles.length === 0) return null;
    return baseCandles[baseCandles.length - 1].close;
  }

  /**
   * Calculate Average True Range (ATR) for volatility
   */
  getATR(timeframe = '1h', period = 14) {
    const candles = this.getCandles(timeframe, period + 1);
    if (candles.length < period + 1) return null;
    
    let trSum = 0;
    for (let i = 1; i < candles.length; i++) {
      const prev = candles[i - 1];
      const curr = candles[i];
      
      const tr1 = curr.high - curr.low;
      const tr2 = Math.abs(curr.high - prev.close);
      const tr3 = Math.abs(curr.low - prev.close);
      
      trSum += Math.max(tr1, tr2, tr3);
    }
    
    return trSum / period;
  }

  /**
   * Get trend strength (ADX approximation)
   */
  getTrendStrength(timeframe = '1h') {
    const snapshot = this.getTimeframeSnapshot(timeframe);
    if (!snapshot.warmedUp) return null;
    
    // Use EMA spread as trend strength proxy
    if (!snapshot.ema12 || !snapshot.ema26) return 0;
    
    const spread = Math.abs(snapshot.ema12 - snapshot.ema26) / snapshot.ema26;
    return Math.min(spread * 100, 100); // Normalize to 0-100
  }

  /**
   * Reset all states
   */
  reset() {
    for (const tf of this.timeframes) {
      this.states[tf] = new IndicatorState();
      this.candleBuffers[tf] = [];
    }
    this.candlesProcessed = 0;
  }

  /**
   * Get status summary
   */
  getStatus() {
    return {
      timeframes: this.timeframes,
      candlesProcessed: this.candlesProcessed,
      warmedUp: this.isWarmedUp(),
      timeframeStatus: this.timeframes.reduce((acc, tf) => {
        const snapshot = this.states[tf].getSnapshot();
        acc[tf] = {
          warmedUp: snapshot.warmedUp,
          candles: this.candleBuffers[tf].length
        };
        return acc;
      }, {})
    };
  }
}

module.exports = MultiTimeframeIndicatorState;
