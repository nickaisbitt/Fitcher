const logger = require('../utils/logger');
const IndicatorState = require('./IndicatorState');

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
        
        // Update strategy internal state (for V2 strategies)
        if (strategy.update) {
          strategy.update(candle, candle.pair || 'BTC/USD');
        }

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

      // ⚡ Bolt Optimization: Replaced O(N^2) multi-pass array allocation and reduction with a single-pass Welford's algorithm.
      // Impact: Reduces complexity from O(3N) to O(N) and eliminates garbage collection overhead in a hot loop (called per trade).
      const startIdx = Math.max(1, candles.length - 20);
      let count = 0;
      let mean = 0;
      let M2 = 0;

      for (let i = startIdx; i < candles.length; i++) {
        const ret = (candles[i].close - candles[i - 1].close) / candles[i - 1].close;
        count++;
        const delta = ret - mean;
        mean += delta / count;
        const delta2 = ret - mean;
        M2 += delta * delta2;
      }

      if (count > 0) {
        const variance = M2 / count;
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

    // ⚡ Bolt Optimization: Replaced chained .filter().reduce() with a single-pass loop.
    // Impact: Consolidates 4 separate O(N) array iterations into a single O(N) loop, significantly reducing CPU cycles and memory overhead.
    let winnersCount = 0;
    let losersCount = 0;
    let totalWin = 0;
    let totalLossRaw = 0;

    for (let i = 0; i < completedTrades.length; i++) {
      const pnl = completedTrades[i].pnl;
      if (pnl > 0) {
        winnersCount++;
        totalWin += pnl;
      } else {
        losersCount++;
        totalLossRaw += pnl;
      }
    }

    const totalLoss = Math.abs(totalLossRaw);

    return {
      winningTrades: winnersCount,
      losingTrades: losersCount,
      winRate: (winnersCount / completedTrades.length) * 100,
      avgWin: winnersCount > 0 ? totalWin / winnersCount : 0,
      avgLoss: losersCount > 0 ? totalLoss / losersCount : 0,
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
