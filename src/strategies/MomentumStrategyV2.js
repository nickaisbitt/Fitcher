const logger = require('../utils/logger');
const MultiTimeframeIndicatorState = require('../services/MultiTimeframeIndicatorState');

/**
 * MomentumStrategyV2 - Multi-timeframe momentum trading
 * Uses EMA crossover + MACD + volume confirmation
 * Analyzes 15m, 1h, 4h, 1d for trend alignment
 */
class MomentumStrategyV2 {
  constructor(config = {}) {
    this.name = 'Momentum v2';
    this.description = 'Multi-timeframe momentum with trend alignment';
    
    this.config = {
      // Primary timeframe for signals (1h recommended)
      primaryTimeframe: config.primaryTimeframe || '1h',
      
      // Timeframes to analyze
      timeframes: config.timeframes || ['15m', '1h', '4h', '1d'],
      
      // Entry conditions
      minTrendAlignment: config.minTrendAlignment || 2, // At least 2 timeframes must agree
      minConfidence: config.minConfidence || 0.65,
      
      // EMA settings (tuned for crypto)
      emaFast: config.emaFast || 9,  // Changed from 12 to 9 (more responsive)
      emaSlow: config.emaSlow || 21, // Changed from 26 to 21
      
      // RSI filter (research: RSI > 50 for longs improves win rate)
      requireRsiFilter: config.requireRsiFilter !== false,
      rsiThreshold: config.rsiThreshold || 50,
      
      // ADX-style trend strength filter (research: ADX > 20 filters chop)
      requireAdxFilter: config.requireAdxFilter !== false,
      adxThreshold: config.adxThreshold || 20,
      
      // MACD confirmation
      requireMacdConfirmation: config.requireMacdConfirmation !== false,
      
      // Volume confirmation
      requireVolumeConfirmation: config.requireVolumeConfirmation !== false,
      volumeThreshold: config.volumeThreshold || 1.2, // 20% above average
      
      // ATR-based risk (tighter stops per research)
      stopLossAtrMultiplier: config.stopLossAtrMultiplier || 1.5, // 1.5x ATR (was 2x)
      takeProfitAtrMultiplier: config.takeProfitAtrMultiplier || 2.5, // 2.5x ATR (was 4x)
      trailingStopAtrMultiplier: config.trailingStopAtrMultiplier || 1.0, // 1.0x ATR (was 1.5x)
      
      // Position sizing
      basePositionSize: config.basePositionSize || 0.10, // 10% of balance
      maxPositionSize: config.maxPositionSize || 0.20,   // 20% max
      
      // Exit conditions
      maxHoldTime: config.maxHoldTime || 12 * 60 * 60 * 1000, // 12 hours
      
      ...config
    };
    
    // Indicator state for each pair
    this.indicatorStates = new Map();
    
    // Track active signals
    this.activeSignals = new Map();
    
    // Performance tracking
    this.signals = [];
    this.trades = [];
    
    // Position tracking (for standalone use and tests)
    this.position = null;
    this.highestPrice = 0;
  }

  /**
   * Initialize indicator state for a pair
   */
  initializePair(pair) {
    if (!this.indicatorStates.has(pair)) {
      this.indicatorStates.set(pair, new MultiTimeframeIndicatorState(this.config.timeframes));
      logger.info(`MomentumStrategyV2 initialized for ${pair}`);
    }
    return this.indicatorStates.get(pair);
  }

  /**
   * Update with new market data
   */
  update(candle, pair) {
    const state = this.initializePair(pair);
    state.update(candle);
  }

  /**
   * Generate trading signal
   */
  async generateSignal(marketData) {
    try {
      const { pair, price, volume, timestamp, indicators } = marketData;
      
      // Get or initialize indicator state
      const state = this.initializePair(pair);
      
      // Use provided indicators if available (for tests/legacy compatibility)
      let snapshot;
      if (indicators && (indicators.ema12 || indicators.rsi || indicators.bb)) {
        snapshot = {
          [this.config.primaryTimeframe]: indicators,
          overallWarmedUp: true,
          trendAlignment: 'unknown'
        };
      } else {
        snapshot = state.getSnapshot();
      }
      
      // Check if warmed up
      if (!snapshot.overallWarmedUp && !indicators) {
        return {
          action: 'hold',
          confidence: 0,
          reason: 'Indicators warming up...',
          strategy: this.name
        };
      }

      // Update highest price for trailing stop
      const atr = state.getATR(this.config.primaryTimeframe, 14);
      if (this.position && price > this.highestPrice) {
        this.highestPrice = price;
        // Dynamic ATR trailing stop
        const trailingDist = atr ? atr * this.config.trailingStopAtrMultiplier : price * 0.03;
        this.position.trailingStop = this.highestPrice - trailingDist;
      }

      // Get primary timeframe indicators
      const primaryIndicators = snapshot[this.config.primaryTimeframe];
      
      // Calculate signal components
      const emaSignal = this.calculateEMASignal(primaryIndicators);
      const macdSignal = this.calculateMACDSignal(primaryIndicators);

      // Check for exit signals if holding position
      if (this.position) {
        // 1. Trailing stop hit
        if (this.position.trailingStop && price <= this.position.trailingStop) {
          return {
            action: 'sell',
            confidence: 0.95,
            reason: `Trailing stop hit at ${price} (ATR based)`,
            strategy: this.name,
            pair, price, amount: this.position.amount
          };
        }

        // 2. Stop loss hit (Hard stop)
        if (this.position.stopLoss && price <= this.position.stopLoss) {
          return {
            action: 'sell',
            confidence: 1.0,
            reason: `Stop loss hit at ${price}`,
            strategy: this.name,
            pair, price, amount: this.position.amount
          };
        }

        // 3. MACD bearish reversal (Trend Exhaustion)
        if (macdSignal.bearish && this.config.requireMacdConfirmation) {
          return {
            action: 'sell',
            confidence: 0.8,
            reason: 'MACD bearish reversal',
            strategy: this.name,
            pair, price, amount: this.position.amount
          };
        }

        // 4. Max hold time exit
        if (this.position.entryTime && Date.now() - this.position.entryTime > this.config.maxHoldTime) {
          return {
            action: 'sell',
            confidence: 0.75,
            reason: `Max hold time reached`,
            strategy: this.name,
            pair, price, amount: this.position.amount
          };
        }
      }

      // Analyze trend alignment
      const alignment = this.analyzeTrendAlignment(snapshot);
      const volumeSignal = this.calculateVolumeSignal(marketData, state);
      
      // Get RSI for momentum filter (research: RSI > 50 for longs improves win rate)
      const rsi = snapshot.rsi || 50;
      
      // Get ADX-style trend strength
      const trendStrength = state.getTrendStrength ? state.getTrendStrength() : 0;
      
      // Combine signals
      const combinedSignal = this.combineSignals(
        emaSignal,
        macdSignal,
        volumeSignal,
        alignment
      );
      
      // Determine action
      let action = 'hold';
      let confidence = combinedSignal.confidence;
      let reason = combinedSignal.reason;
      
      // RSI Filter: Only buy if RSI aligned with trend (research shows this improves win rate)
      const rsiAlignedForBuy = !this.config.requireRsiFilter || rsi > this.config.rsiThreshold;
      const rsiAlignedForSell = !this.config.requireRsiFilter || rsi < this.config.rsiThreshold;
      
      // ADX Filter: Only trade if trend is strong enough (filters choppy markets)
      const adxFilterPasses = !this.config.requireAdxFilter || trendStrength > this.config.adxThreshold;
      
      if (combinedSignal.bullish && alignment.score >= this.config.minTrendAlignment) {
        if (this.position) {
          action = 'hold';
          reason = 'Already in position';
        } else
        // Apply RSI and ADX filters
        if (!rsiAlignedForBuy) {
          action = 'hold';
          reason = `RSI ${rsi.toFixed(1)} below ${this.config.rsiThreshold} threshold`;
        } else if (!adxFilterPasses) {
          action = 'hold';
          reason = `ADX filter: trend strength ${trendStrength.toFixed(1)} below ${this.config.adxThreshold}`;
        } else {
          action = 'buy';
          confidence = Math.min(confidence * alignment.bullishScore, 0.95);
        }
      } else if (combinedSignal.bearish && alignment.score <= -this.config.minTrendAlignment) {
        // Only sell if we have a position (spot-only)
        if (this.position) {
          // Apply RSI filter for sells (exit when RSI crosses below 50)
          if (!rsiAlignedForSell) {
            action = 'hold';
            reason = `RSI ${rsi.toFixed(1)} above ${this.config.rsiThreshold} threshold - not exiting yet`;
          } else {
            action = 'sell';
            confidence = Math.min(confidence * alignment.bearishScore, 0.95);
          }
        } else {
          action = 'hold';
          reason = `Bearish signal (${combinedSignal.reason}) but no position to sell`;
        }
      }
      
      // Check if confidence meets threshold
      if (confidence < this.config.minConfidence) {
        action = 'hold';
        reason = `Confidence ${confidence.toFixed(2)} below threshold ${this.config.minConfidence}`;
      }
      
      // Calculate position size based on confidence and trend strength
      const positionSize = this.calculatePositionSize(confidence, alignment) || 0;
      
      // Calculate dynamic stops based on ATR
      const stops = this.calculateDynamicStops(price, atr);
      
      // Build signal
      const signal = {
        action,
        confidence,
        reason,
        strategy: this.name,
        pair,
        price,
        amount: positionSize,
        timestamp,
        
        // Multi-timeframe analysis
        timeframes: snapshot,
        alignment: alignment.direction,
        alignmentScore: alignment.score,
        
        // Technical indicators
        indicators: {
          primary: primaryIndicators,
          trendStrength: state.getTrendStrength(this.config.primaryTimeframe)
        },
        
        // Risk parameters
        stopLoss: stops.stopLoss,
        takeProfit: stops.takeProfit,
        trailingStop: stops.trailingStop,
        
        // Execution parameters
        urgency: confidence > 0.8 ? 'high' : 'normal',
        orderType: this.selectOrderType(alignment, confidence)
      };
      
      // Store signal
      this.signals.push({
        ...signal,
        id: `sig_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      });
      
      // Trim signal history
      if (this.signals.length > 1000) {
        this.signals.shift();
      }
      
      if (action !== 'hold') {
        logger.info(`MomentumStrategyV2 signal: ${action} ${pair} @ ${price} (conf: ${confidence.toFixed(2)})`);
      }
      
      return signal;
      
    } catch (error) {
      logger.error('MomentumStrategyV2 error:', error);
      return {
        action: 'hold',
        confidence: 0,
        reason: 'Strategy error',
        strategy: this.name
      };
    }
  }

  /**
   * Analyze trend alignment across timeframes
   */
  analyzeTrendAlignment(snapshot) {
    let bullishCount = 0;
    let bearishCount = 0;
    let strongBullish = 0;
    let strongBearish = 0;
    
    for (const [tf, indicators] of Object.entries(snapshot)) {
      if (tf === 'trendAlignment' || tf === 'overallWarmedUp') continue;
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
    
    return {
      score,
      direction,
      bullishScore: totalBullish / 4, // Normalize to 0-1
      bearishScore: totalBearish / 4,
      details: { bullishCount, bearishCount, strongBullish, strongBearish }
    };
  }

  /**
   * Calculate EMA crossover signal
   */
  calculateEMASignal(indicators) {
    if (!indicators.ema12 || !indicators.ema26) {
      return { bullish: false, bearish: false, strength: 0 };
    }
    
    const diff = indicators.ema12 - indicators.ema26;
    const diffPct = diff / indicators.ema26;
    
    if (diff > 0) {
      return {
        bullish: true,
        bearish: false,
        strength: Math.min(diffPct * 100, 1),
        spread: diffPct
      };
    } else {
      return {
        bullish: false,
        bearish: true,
        strength: Math.min(Math.abs(diffPct) * 100, 1),
        spread: diffPct
      };
    }
  }

  /**
   * Calculate MACD signal
   */
  calculateMACDSignal(indicators) {
    if (!indicators.macd || !indicators.macd.histogram) {
      return { bullish: false, bearish: false, strength: 0 };
    }
    
    const histogram = indicators.macd.histogram;
    const maxHist = 100;
    
    if (histogram > 0) {
      return {
        bullish: true,
        bearish: false,
        strength: Math.min(histogram / maxHist, 1),
        histogram
      };
    } else {
      return {
        bullish: false,
        bearish: true,
        strength: Math.min(Math.abs(histogram) / maxHist, 1),
        histogram
      };
    }
  }

  /**
   * Calculate volume confirmation signal
   */
  calculateVolumeSignal(marketData, state) {
    if (!marketData.volume || !this.config.requireVolumeConfirmation) {
      return { bullish: true, bearish: true, strength: 0.5 };
    }
    
    const candles = state.getCandles(this.config.primaryTimeframe, 20);
    if (candles.length < 10) {
      return { bullish: true, bearish: true, strength: 0.5 };
    }
    
    const avgVolume = candles.reduce((sum, c) => sum + (c.volume || 0), 0) / candles.length;
    const currentVolume = marketData.volume;
    const volumeRatio = currentVolume / avgVolume;
    
    return {
      bullish: volumeRatio > this.config.volumeThreshold,
      bearish: volumeRatio > this.config.volumeThreshold,
      strength: Math.min(volumeRatio - 0.5, 1),
      volumeRatio
    };
  }

  /**
   * Combine all signal components
   */
  combineSignals(emaSignal, macdSignal, volumeSignal, alignment) {
    let bullishScore = 0;
    let bearishScore = 0;
    let totalWeight = 0;
    const reasons = [];
    
    // EMA signal (weight: 0.4)
    if (emaSignal.bullish) {
      bullishScore += emaSignal.strength * 0.4;
      reasons.push(`EMA bullish spread ${(emaSignal.spread * 100).toFixed(2)}%`);
    } else if (emaSignal.bearish) {
      bearishScore += emaSignal.strength * 0.4;
      reasons.push(`EMA bearish spread ${(emaSignal.spread * 100).toFixed(2)}%`);
    }
    totalWeight += 0.4;
    
    // MACD signal (weight: 0.3)
    if (this.config.requireMacdConfirmation) {
      if (macdSignal.bullish) {
        bullishScore += macdSignal.strength * 0.3;
        reasons.push(`MACD histogram ${macdSignal.histogram.toFixed(2)}`);
      } else if (macdSignal.bearish) {
        bearishScore += macdSignal.strength * 0.3;
        reasons.push(`MACD histogram ${macdSignal.histogram.toFixed(2)}`);
      }
      totalWeight += 0.3;
    }
    
    // Volume signal (weight: 0.2)
    if (this.config.requireVolumeConfirmation) {
      if (volumeSignal.bullish) {
        bullishScore += volumeSignal.strength * 0.2;
        reasons.push(`Volume ${volumeSignal.volumeRatio?.toFixed(2)}x average`);
      } else {
        bearishScore += volumeSignal.strength * 0.2;
        reasons.push(`Volume ${volumeSignal.volumeRatio?.toFixed(2)}x average`);
      }
      totalWeight += 0.2;
    }
    
    // Trend alignment bonus (weight: 0.1)
    if (alignment.direction.includes('uptrend')) {
      bullishScore += alignment.bullishScore * 0.1;
      reasons.push(`Trend alignment: ${alignment.direction}`);
    } else if (alignment.direction.includes('downtrend')) {
      bearishScore += alignment.bearishScore * 0.1;
      reasons.push(`Trend alignment: ${alignment.direction}`);
    }
    totalWeight += 0.1;
    
    // Normalize
    const maxScore = totalWeight;
    bullishScore /= maxScore;
    bearishScore /= maxScore;
    
    const confidence = Math.max(bullishScore, bearishScore);
    
    return {
      bullish: bullishScore > bearishScore,
      bearish: bearishScore > bullishScore,
      confidence,
      bullishScore,
      bearishScore,
      reason: reasons.join(', ')
    };
  }

  /**
   * Calculate position size based on confidence and alignment
   */
  calculatePositionSize(confidence, alignment) {
    let size = this.config.basePositionSize * confidence;
    
    if (alignment.direction === 'strong_uptrend') {
      size *= 1.5;
    } else if (alignment.direction === 'uptrend') {
      size *= 1.2;
    }
    
    return Math.min(size, this.config.maxPositionSize);
  }

  /**
   * Calculate dynamic stops based on ATR
   */
  calculateDynamicStops(price, atr) {
    if (!atr || atr === 0) {
      // Fallback to percentage-based
      return {
        stopLoss: price * (1 - this.config.stopLoss),
        takeProfit: price * (1 + this.config.takeProfit),
        trailingStop: price * (1 - this.config.trailingStop) // Trailing stop is a % reduction
      };
    }
    
    // ATR-based stops
    const stopDistance = atr * this.config.stopLossAtrMultiplier;
    const profitDistance = atr * this.config.takeProfitAtrMultiplier;
    const trailingDistance = atr * this.config.trailingStopAtrMultiplier;
    
    return {
      stopLoss: price - stopDistance,
      takeProfit: price + profitDistance,
      trailingStop: price * (1 - trailingDistance / price) // Convert distance to percentage reduction from current price
    };
  }

  /**
   * Select order type based on conditions
   */
  selectOrderType(alignment, confidence) {
    if (confidence > 0.85 && alignment.direction === 'strong_uptrend') {
      return 'market';
    }
    return 'limit';
  }

  /**
   * Get current strategy configuration
   */
  getConfig() {
    return { ...this.config };
  }

  /**
   * Get performance statistics
   */
  getPerformance() {
    const totalSignals = this.signals.length;
    const buySignals = this.signals.filter(s => s.action === 'buy').length;
    const sellSignals = this.signals.filter(s => s.action === 'sell').length;
    const avgConfidence = totalSignals > 0 
      ? this.signals.reduce((sum, s) => sum + s.confidence, 0) / totalSignals 
      : 0;
    
    return {
      name: this.name,
      totalSignals,
      buySignals,
      sellSignals,
      avgConfidence,
      recentTrades: this.trades.slice(-10)
    };
  }

  /**
   * Reset strategy state
   */
  reset() {
    this.indicatorStates.clear();
    this.signals = [];
    this.trades = [];
    logger.info('MomentumStrategyV2 reset');
  }
}

module.exports = MomentumStrategyV2;
