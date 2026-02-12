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
    this.bb = { buffer: [], sum: 0, sumSq: 0, period: 20, stdDev: 2, value: null };
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
      this.smas[name] = { buffer: [], sum: 0, value: null };
    }
    const state = this.smas[name];

    state.buffer.push(close);
    state.sum += close;

    if (state.buffer.length > period) {
      state.sum -= state.buffer.shift();
    }

    state.value = state.buffer.length >= period ? state.sum / period : null;
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
    s.buffer.push(close);
    s.sum += close;
    s.sumSq += close * close;

    if (s.buffer.length > s.period) {
      const removed = s.buffer.shift();
      s.sum -= removed;
      s.sumSq -= removed * removed;
    }

    if (s.buffer.length >= s.period) {
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

/**
 * BacktestEngine - Simulates trading strategies on historical data
 * with realistic execution (slippage, fees), stateful indicators,
 * and proper trade pairing.
 */
class BacktestEngine {
  constructor(config = {}) {
    this.config = {
      initialBalance: config.initialBalance || 10000,
      makerFee: config.makerFee || 0.001, // 0.1%
      takerFee: config.takerFee || 0.002, // 0.2%
      slippageModel: config.slippageModel || 'fixed',
      slippageBps: config.slippageBps || 5,
      enableLogging: config.enableLogging !== false,
      warmUpPeriod: config.warmUpPeriod || 50,
      timeframeMs: config.timeframeMs || null, // auto-detect from data
      ...config
    };

    this.results = null;
    this.trades = [];
    this.equityCurve = [];
    this.balance = this.config.initialBalance;
    this.holdings = new Map();
    this.indicatorState = null;
  }

  /**
   * Run backtest for a strategy
   */
  async run(strategy, historicalData, options = {}) {
    try {
      if (!historicalData || historicalData.length === 0) {
        throw new Error('No historical data provided');
      }

      const enableLogging = options.enableLogging !== undefined ? options.enableLogging : this.config.enableLogging;
      if (enableLogging) {
        logger.info(`Starting backtest for strategy: ${strategy.name || 'Unnamed'}`);
        logger.info(`Data points: ${historicalData.length}, Initial balance: $${this.config.initialBalance}`);
      }

      this.reset();
      this.indicatorState = new IndicatorState();

      // Auto-detect timeframe for Sharpe annualization
      if (!this.config.timeframeMs && historicalData.length >= 2) {
        this.config.timeframeMs = historicalData[1].timestamp - historicalData[0].timestamp;
      }

      const startTime = Date.now();
      const signals = [];

      // Process each candle
      for (let i = 0; i < historicalData.length; i++) {
        const candle = historicalData[i];

        // Update indicators incrementally
        this.indicatorState.update(candle.close);

        // Skip warm-up period -- indicators aren't stable yet
        if (i < this.config.warmUpPeriod) {
          this.recordEquity(candle.timestamp, candle.close);
          continue;
        }

        const marketData = this.formatMarketData(candle, historicalData, i);

        // Generate signal from strategy
        const signal = await strategy.generateSignal(marketData);

        if (signal && signal.action !== 'hold') {
          signals.push({
            timestamp: candle.timestamp,
            action: signal.action,
            price: signal.price || candle.close,
            confidence: signal.confidence,
            reason: signal.reason
          });

          this.executeSignal(signal, candle, marketData);
        }

        this.recordEquity(candle.timestamp, candle.close);
      }

      // Close remaining positions at last price
      const lastCandle = historicalData[historicalData.length - 1];
      this.closeAllPositions(lastCandle);

      const endTime = Date.now();
      this.results = this.calculateResults(historicalData, signals, endTime - startTime);

      if (enableLogging) {
        logger.info(`Backtest completed in ${endTime - startTime}ms`);
        logger.info(`Final balance: $${this.results.summary.finalBalance.toFixed(2)}, Return: ${this.results.summary.totalReturn.toFixed(2)}%`);
      }

      return this.results;
    } catch (error) {
      logger.error('Backtest error:', error);
      throw error;
    }
  }

  /**
   * Format market data for strategy - uses stateful indicators
   */
  formatMarketData(candle, allData, index) {
    // Provide a reasonable lookback window for strategies that need raw candles
    const lookback = Math.min(index + 1, 100);
    const recentCandles = allData.slice(index + 1 - lookback, index + 1);

    return {
      timestamp: candle.timestamp,
      pair: candle.pair || 'BTC/USD',
      price: candle.close,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      recentCandles,
      indicators: this.indicatorState.getSnapshot()
    };
  }

  /**
   * Execute trading signal
   */
  executeSignal(signal, candle, marketData) {
    const { action, amount, price } = signal;
    const executionPrice = this.calculateExecutionPrice(action, price || candle.close, marketData);
    const asset = marketData.pair.split('/')[0];

    // Normalize amount: if amount > 0 and < 1 AND explicitly a fraction, use as % of balance
    // If amount >= 2, treat as absolute units
    // Default: use 10% of balance
    let qty;
    if (amount === undefined || amount === null) {
      qty = (this.balance * 0.1) / executionPrice;
    } else if (amount > 0 && amount < 1) {
      qty = (this.balance * amount) / executionPrice;
    } else if (amount === 1) {
      // Ambiguous -- treat as 100% of balance for safety
      qty = (this.balance * 1.0) / executionPrice;
    } else {
      qty = amount; // absolute units
    }

    if (!qty || qty <= 0) return;

    if (action === 'buy') {
      this.executeBuy(asset, executionPrice, qty, candle.timestamp);
    } else if (action === 'sell') {
      // Only sell what we actually hold (no shorting in spot mode)
      const held = this.holdings.get(asset) || 0;
      if (held <= 0) return;
      const sellQty = Math.min(qty, held);
      this.executeSell(asset, executionPrice, sellQty, candle.timestamp);
    }
  }

  executeBuy(asset, price, amount, timestamp) {
    const cost = amount * price;
    const fee = cost * this.config.takerFee;
    const totalCost = cost + fee;

    if (totalCost > this.balance) {
      // Buy what we can afford
      const affordable = this.balance / (price * (1 + this.config.takerFee));
      if (affordable <= 0) return;
      return this.executeBuy(asset, price, affordable, timestamp);
    }

    this.balance -= totalCost;
    const currentAmount = this.holdings.get(asset) || 0;
    this.holdings.set(asset, currentAmount + amount);

    this.trades.push({
      timestamp, side: 'buy', asset, amount, price, fee, totalCost,
      balance: this.balance
    });
  }

  executeSell(asset, price, amount, timestamp) {
    const currentAmount = this.holdings.get(asset) || 0;
    if (amount > currentAmount) amount = currentAmount;
    if (amount <= 0) return;

    const proceeds = amount * price;
    const fee = proceeds * this.config.takerFee;
    const netProceeds = proceeds - fee;

    this.balance += netProceeds;
    this.holdings.set(asset, currentAmount - amount);

    this.trades.push({
      timestamp, side: 'sell', asset, amount, price, fee, netProceeds,
      balance: this.balance
    });
  }

  closeAllPositions(lastCandle) {
    for (const [asset, amount] of this.holdings) {
      if (amount > 0) {
        this.executeSell(asset, lastCandle.close, amount, lastCandle.timestamp);
      }
    }
  }

  calculateExecutionPrice(side, targetPrice, marketData) {
    if (this.config.slippageModel === 'none') return targetPrice;

    let slippage = this.config.slippageBps / 10000;

    if (this.config.slippageModel === 'dynamic' && marketData.recentCandles?.length >= 2) {
      const candles = marketData.recentCandles;
      const returns = [];
      for (let i = Math.max(1, candles.length - 20); i < candles.length; i++) {
        returns.push((candles[i].close - candles[i - 1].close) / candles[i - 1].close);
      }
      if (returns.length > 0) {
        const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
        const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
        slippage *= (1 + Math.sqrt(variance));
      }
    }

    return side === 'buy' ? targetPrice * (1 + slippage) : targetPrice * (1 - slippage);
  }

  recordEquity(timestamp, currentPrice) {
    let holdingsValue = 0;
    for (const [, amount] of this.holdings) {
      holdingsValue += amount * currentPrice;
    }
    this.equityCurve.push({
      timestamp,
      balance: this.balance,
      holdingsValue,
      totalEquity: this.balance + holdingsValue
    });
  }

  calculateResults(historicalData, signals, duration) {
    const initialBalance = this.config.initialBalance;
    const finalBalance = this.balance;
    const totalReturn = ((finalBalance - initialBalance) / initialBalance) * 100;
    const drawdowns = this.calculateDrawdowns();
    const tradeStats = this.calculateTradeStats();
    const sharpeRatio = this.calculateSharpeRatio();

    return {
      summary: {
        initialBalance, finalBalance, totalReturn,
        totalTrades: this.trades.length,
        winningTrades: tradeStats.winningTrades,
        losingTrades: tradeStats.losingTrades,
        winRate: tradeStats.winRate,
        avgWin: tradeStats.avgWin,
        avgLoss: tradeStats.avgLoss,
        profitFactor: tradeStats.profitFactor,
        maxDrawdown: drawdowns.maxDrawdown,
        maxDrawdownPercent: drawdowns.maxDrawdownPercent,
        sharpeRatio,
        duration
      },
      trades: this.trades,
      equityCurve: this.equityCurve,
      signals,
      drawdowns: drawdowns.series
    };
  }

  calculateDrawdowns() {
    let peak = this.equityCurve[0]?.totalEquity || this.config.initialBalance;
    let maxDrawdown = 0;
    let maxDrawdownPercent = 0;
    const series = [];

    for (const point of this.equityCurve) {
      if (point.totalEquity > peak) peak = point.totalEquity;
      const drawdown = peak - point.totalEquity;
      const drawdownPercent = (drawdown / peak) * 100;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
        maxDrawdownPercent = drawdownPercent;
      }
      series.push({ timestamp: point.timestamp, peak, equity: point.totalEquity, drawdown, drawdownPercent });
    }

    return { maxDrawdown, maxDrawdownPercent, series };
  }

  /**
   * Trade pairing: stack-based, handles multiple buys before a sell
   */
  calculateTradeStats() {
    const completedTrades = [];
    // Clone buy trades so pairing doesn't mutate the original trade records
    const openBuys = [];

    for (const trade of this.trades) {
      if (trade.side === 'buy') {
        openBuys.push({ ...trade, remainingAmount: trade.amount });
      } else if (trade.side === 'sell') {
        let remainingSellAmount = trade.amount;

        while (remainingSellAmount > 0 && openBuys.length > 0) {
          const buy = openBuys[0];
          const matchAmount = Math.min(remainingSellAmount, buy.remainingAmount);
          const pnl = (trade.price - buy.price) * matchAmount;

          completedTrades.push({
            entryPrice: buy.price,
            exitPrice: trade.price,
            amount: matchAmount,
            pnl,
            pnlPercent: (pnl / (buy.price * matchAmount)) * 100,
            duration: trade.timestamp - buy.timestamp
          });

          remainingSellAmount -= matchAmount;
          buy.remainingAmount -= matchAmount;

          if (buy.remainingAmount <= 0) {
            openBuys.shift();
          }
        }
      }
    }

    if (completedTrades.length === 0) {
      return { winningTrades: 0, losingTrades: 0, winRate: 0, avgWin: 0, avgLoss: 0, profitFactor: 0 };
    }

    const winners = completedTrades.filter(t => t.pnl > 0);
    const losers = completedTrades.filter(t => t.pnl <= 0);
    const totalWin = winners.reduce((s, t) => s + t.pnl, 0);
    const totalLoss = Math.abs(losers.reduce((s, t) => s + t.pnl, 0));

    return {
      winningTrades: winners.length,
      losingTrades: losers.length,
      winRate: (winners.length / completedTrades.length) * 100,
      avgWin: winners.length > 0 ? totalWin / winners.length : 0,
      avgLoss: losers.length > 0 ? totalLoss / losers.length : 0,
      profitFactor: totalLoss > 0 ? totalWin / totalLoss : totalWin > 0 ? Infinity : 0
    };
  }

  /**
   * Sharpe ratio with timeframe-aware annualization
   */
  calculateSharpeRatio() {
    if (this.equityCurve.length < 2) return 0;

    const returns = [];
    for (let i = 1; i < this.equityCurve.length; i++) {
      const prev = this.equityCurve[i - 1].totalEquity;
      const curr = this.equityCurve[i].totalEquity;
      if (prev > 0) returns.push((curr - prev) / prev);
    }

    if (returns.length === 0) return 0;

    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    if (stdDev === 0) return 0;

    // Calculate annualization factor from timeframe
    const tfMs = this.config.timeframeMs || 3600000; // default 1h
    const periodsPerYear = (365.25 * 24 * 60 * 60 * 1000) / tfMs;

    return (mean * periodsPerYear) / (stdDev * Math.sqrt(periodsPerYear));
  }

  reset() {
    this.results = null;
    this.trades = [];
    this.equityCurve = [];
    this.balance = this.config.initialBalance;
    this.holdings.clear();
    this.indicatorState = null;
  }

  getResults() { return this.results; }
  exportResults() { return JSON.stringify(this.results, null, 2); }
}

module.exports = BacktestEngine;
