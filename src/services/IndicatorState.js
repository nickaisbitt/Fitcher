const logger = require('../utils/logger');

/**
 * IndicatorState - Maintains stateful, incrementally-updated technical indicators.
 * EMA, RSI (Wilder), MACD, Bollinger Bands are computed correctly using
 * running state that persists across candles, not recomputed from scratch.
 */
class IndicatorState {
  constructor() {
    // EMA state: { value, initialized }
    this.emas = {};
    // SMA state: { buffer, sum, value }
    this.smas = {};
    // RSI state (Wilder): { avgGain, avgLoss, prevClose, initialized, count }
    this.rsi = { avgGain: 0, avgLoss: 0, prevClose: null, initialized: false, count: 0, period: 14, value: null };
    // MACD state
    this.macd = { line: null, signal: null, histogram: null };
    // Bollinger state: { buffer, sum, sumSq }
    this.bb = { buffer: new Array(20), sum: 0, sumSq: 0, period: 20, stdDev: 2, value: null, head: 0, count: 0 };
    // Count of candles processed (for warm-up)
    this.candlesProcessed = 0;
  }

  /**
   * Update all indicators with a new close price.
   * Call once per candle, in order.
   */
  update(close) {
    this.candlesProcessed++;

    // Update EMAs
    this._updateEMA('ema12', close, 12);
    this._updateEMA('ema26', close, 26);
    // SMA20 for Bollinger, SMA50 for trend
    this._updateSMA('sma20', close, 20);
    this._updateSMA('sma50', close, 50);
    // RSI (Wilder's smoothing, period 14)
    this._updateRSI(close);
    // Bollinger Bands (period 20, stdDev 2)
    this._updateBollinger(close);
    // MACD (from ema12 and ema26, signal = 9-period EMA of MACD line)
    this._updateMACD();
  }

  /**
   * Get current indicator snapshot.
   * Returns null for indicators that haven't warmed up yet.
   */
  getSnapshot() {
    return {
      ema12: this.emas.ema12?.value ?? null,
      ema26: this.emas.ema26?.value ?? null,
      sma20: this.smas.sma20?.value ?? null,
      sma50: this.smas.sma50?.value ?? null,
      rsi: this.rsi.value,
      bb: this.bb.value,
      macd: this.macd.line !== null ? { ...this.macd } : null,
      warmedUp: this.candlesProcessed >= 50 // need at least 50 candles for all indicators
    };
  }

  /** Incremental EMA: ema = close * k + prevEma * (1 - k) */
  _updateEMA(name, close, period) {
    if (!this.emas[name]) {
      this.emas[name] = { buffer: [], sum: 0, value: null, initialized: false };
    }
    const state = this.emas[name];

    if (!state.initialized) {
      state.buffer.push(close);
      state.sum += close;
      if (state.buffer.length === period) {
        state.value = state.sum / period; // seed with SMA
        state.initialized = true;
        state.buffer = null; // free memory
        state.sum = 0;
      }
    } else {
      const k = 2 / (period + 1);
      state.value = close * k + state.value * (1 - k);
    }
  }

  /** Incremental SMA with ring buffer */
  _updateSMA(name, close, period) {
    if (!this.smas[name]) {
      this.smas[name] = { buffer: new Array(period), sum: 0, value: null, head: 0, count: 0 };
    }
    const state = this.smas[name];

    if (state.count < period) {
      state.buffer[state.head] = close;
      state.sum += close;
      state.count++;
      state.head = (state.head + 1) % period;
    } else {
      const removed = state.buffer[state.head];
      state.sum -= removed;
      state.buffer[state.head] = close;
      state.sum += close;
      state.head = (state.head + 1) % period;
    }

    state.value = state.count >= period ? state.sum / period : null;
  }

  /** Wilder's RSI with exponential smoothing */
  _updateRSI(close) {
    const s = this.rsi;
    if (s.prevClose === null) {
      s.prevClose = close;
      return;
    }

    const change = close - s.prevClose;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    s.prevClose = close;
    s.count++;

    if (!s.initialized) {
      s.avgGain += gain;
      s.avgLoss += loss;
      if (s.count === s.period) {
        s.avgGain /= s.period;
        s.avgLoss /= s.period;
        s.initialized = true;
        s.value = s.avgLoss === 0 ? 100 : 100 - (100 / (1 + s.avgGain / s.avgLoss));
      }
    } else {
      // Wilder's smoothing: avgGain = (prevAvg * (period-1) + currentGain) / period
      s.avgGain = (s.avgGain * (s.period - 1) + gain) / s.period;
      s.avgLoss = (s.avgLoss * (s.period - 1) + loss) / s.period;
      s.value = s.avgLoss === 0 ? 100 : 100 - (100 / (1 + s.avgGain / s.avgLoss));
    }
  }

  /** Bollinger Bands with running sum and sum-of-squares */
  _updateBollinger(close) {
    const s = this.bb;

    if (s.count < s.period) {
      s.buffer[s.head] = close;
      s.sum += close;
      s.sumSq += close * close;
      s.count++;
      s.head = (s.head + 1) % s.period;
    } else {
      const removed = s.buffer[s.head];
      s.sum -= removed;
      s.sumSq -= removed * removed;

      s.buffer[s.head] = close;
      s.sum += close;
      s.sumSq += close * close;
      s.head = (s.head + 1) % s.period;
    }

    if (s.count >= s.period) {
      const mean = s.sum / s.period;
      const variance = (s.sumSq / s.period) - (mean * mean);
      const std = Math.sqrt(Math.max(0, variance)); // guard against floating point
      s.value = {
        upper: mean + s.stdDev * std,
        middle: mean,
        lower: mean - s.stdDev * std
      };
    } else {
      s.value = null;
    }
  }

  /** MACD: line = EMA12 - EMA26, signal = 9-period EMA of MACD line */
  _updateMACD() {
    const ema12 = this.emas.ema12?.value;
    const ema26 = this.emas.ema26?.value;
    if (ema12 === null || ema12 === undefined || ema26 === null || ema26 === undefined) {
      return;
    }

    this.macd.line = ema12 - ema26;

    // Signal line: 9-period EMA of MACD line
    if (!this._macdSignalState) {
      this._macdSignalState = { buffer: [], sum: 0, value: null, initialized: false };
    }
    const ss = this._macdSignalState;
    const signalPeriod = 9;

    if (!ss.initialized) {
      ss.buffer.push(this.macd.line);
      ss.sum += this.macd.line;
      if (ss.buffer.length === signalPeriod) {
        ss.value = ss.sum / signalPeriod;
        ss.initialized = true;
        ss.buffer = null;
        ss.sum = 0;
      }
    } else {
      const k = 2 / (signalPeriod + 1);
      ss.value = this.macd.line * k + ss.value * (1 - k);
    }

    this.macd.signal = ss.value;
    this.macd.histogram = this.macd.signal !== null ? this.macd.line - this.macd.signal : null;
  }
}

module.exports = IndicatorState;
