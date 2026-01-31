const logger = require('../utils/logger');

/**
 * BacktestEngine - Simulates trading strategies on historical data
 * Provides realistic execution with slippage and fees
 */
class BacktestEngine {
  constructor(config = {}) {
    this.config = {
      initialBalance: config.initialBalance || 10000,
      makerFee: config.makerFee || 0.001, // 0.1%
      takerFee: config.takerFee || 0.002, // 0.2%
      slippageModel: config.slippageModel || 'fixed', // 'fixed', 'dynamic', 'none'
      slippageBps: config.slippageBps || 5, // 5 basis points default
      enableLogging: config.enableLogging !== false,
      ...config
    };
    
    this.results = null;
    this.trades = [];
    this.equityCurve = [];
    this.positions = new Map();
    this.balance = this.config.initialBalance;
    this.holdings = new Map(); // asset -> amount
  }

  /**
   * Run backtest for a strategy
   * @param {Object} strategy - Strategy instance
   * @param {Array} historicalData - OHLCV data array
   * @param {Object} options - Backtest options
   */
  async run(strategy, historicalData, options = {}) {
    try {
      logger.info(`Starting backtest for strategy: ${strategy.name || 'Unnamed'}`);
      logger.info(`Data points: ${historicalData.length}, Initial balance: $${this.config.initialBalance}`);

      // Reset state
      this.reset();
      
      const startTime = Date.now();
      const signals = [];
      
      // Process each candle
      for (let i = 0; i < historicalData.length; i++) {
        const candle = historicalData[i];
        const marketData = this.formatMarketData(candle, historicalData, i);
        
        // Generate signal from strategy
        const signal = await strategy.generateSignal(marketData);
        
        if (signal.action !== 'hold') {
          signals.push({
            timestamp: candle.timestamp,
            action: signal.action,
            price: signal.price || candle.close,
            confidence: signal.confidence,
            reason: signal.reason
          });
          
          // Execute signal
          await this.executeSignal(signal, candle, marketData);
        }
        
        // Record equity
        this.recordEquity(candle.timestamp, candle.close);
      }

      // Close any remaining positions at last price
      const lastCandle = historicalData[historicalData.length - 1];
      await this.closeAllPositions(lastCandle);

      // Calculate results
      const endTime = Date.now();
      this.results = this.calculateResults(historicalData, signals, endTime - startTime);

      logger.info(`✅ Backtest completed in ${endTime - startTime}ms`);
      logger.info(`Final balance: $${this.results.summary.finalBalance.toFixed(2)}, Return: ${this.results.summary.totalReturn.toFixed(2)}%`);

      return this.results;
    } catch (error) {
      logger.error('Backtest error:', error);
      throw error;
    }
  }

  /**
   * Execute trading signal
   * @param {Object} signal - Trading signal
   * @param {Object} candle - Current candle
   * @param {Object} marketData - Market data context
   */
  async executeSignal(signal, candle, marketData) {
    const { action, amount, price } = signal;
    const executionPrice = this.calculateExecutionPrice(action, price || candle.close, marketData);
    const normalizedAmount = this.normalizeAmount(amount, executionPrice);
    const asset = marketData.pair.split('/')[0];

    if (!normalizedAmount || normalizedAmount <= 0) {
      return;
    }

    if (action === 'buy') {
      await this.executeBuy(asset, executionPrice, normalizedAmount, candle.timestamp);
    } else if (action === 'sell') {
      await this.executeSell(asset, executionPrice, normalizedAmount, candle.timestamp);
    }
  }

  /**
   * Normalize signal amount
   * If amount <= 1, treat as fraction of current balance
   * @param {number} amount - Signal amount
   * @param {number} price - Execution price
   */
  normalizeAmount(amount, price) {
    if (amount === undefined || amount === null) {
      return 0;
    }

    // Treat fractional amounts as percent of balance
    if (amount > 0 && amount <= 1) {
      const notional = this.balance * amount;
      return notional / price;
    }

    return amount;
  }

  /**
   * Execute buy order
   * @param {string} asset - Asset to buy
   * @param {number} price - Execution price
   * @param {number} amount - Amount to buy
   * @param {number} timestamp - Trade timestamp
   */
  async executeBuy(asset, price, amount, timestamp) {
    const cost = amount * price;
    const fee = cost * this.config.takerFee;
    const totalCost = cost + fee;
    
    if (totalCost > this.balance) {
      if (this.config.enableLogging) {
        logger.warn(`Insufficient balance for buy: need $${totalCost.toFixed(2)}, have $${this.balance.toFixed(2)}`);
      }
      return;
    }
    
    this.balance -= totalCost;
    
    const currentAmount = this.holdings.get(asset) || 0;
    this.holdings.set(asset, currentAmount + amount);
    
    this.trades.push({
      timestamp,
      side: 'buy',
      asset,
      amount,
      price,
      fee,
      totalCost,
      balance: this.balance
    });
    
    if (this.config.enableLogging) {
      logger.debug(`BUY ${amount} ${asset} @ $${price.toFixed(2)}, Fee: $${fee.toFixed(2)}`);
    }
  }

  /**
   * Execute sell order
   * @param {string} asset - Asset to sell
   * @param {number} price - Execution price
   * @param {number} amount - Amount to sell
   * @param {number} timestamp - Trade timestamp
   */
  async executeSell(asset, price, amount, timestamp) {
    const currentAmount = this.holdings.get(asset) || 0;
    
    if (amount > currentAmount) {
      if (this.config.enableLogging) {
        logger.warn(`Insufficient holdings for sell: have ${currentAmount}, want ${amount}`);
      }
      return;
    }
    
    const proceeds = amount * price;
    const fee = proceeds * this.config.takerFee;
    const netProceeds = proceeds - fee;
    
    this.balance += netProceeds;
    this.holdings.set(asset, currentAmount - amount);
    
    this.trades.push({
      timestamp,
      side: 'sell',
      asset,
      amount,
      price,
      fee,
      netProceeds,
      balance: this.balance
    });
    
    if (this.config.enableLogging) {
      logger.debug(`SELL ${amount} ${asset} @ $${price.toFixed(2)}, Fee: $${fee.toFixed(2)}`);
    }
  }

  /**
   * Close all open positions
   * @param {Object} lastCandle - Last candle data
   */
  async closeAllPositions(lastCandle) {
    for (const [asset, amount] of this.holdings) {
      if (amount > 0) {
        await this.executeSell(asset, lastCandle.close, amount, lastCandle.timestamp);
      }
    }
  }

  /**
   * Calculate execution price with slippage
   * @param {string} side - Buy or sell
   * @param {number} targetPrice - Target price
   * @param {Object} marketData - Market data
   */
  calculateExecutionPrice(side, targetPrice, marketData) {
    if (this.config.slippageModel === 'none') {
      return targetPrice;
    }
    
    let slippage = 0;
    
    if (this.config.slippageModel === 'fixed') {
      slippage = this.config.slippageBps / 10000; // Convert basis points to decimal
    } else if (this.config.slippageModel === 'dynamic') {
      // Dynamic slippage based on volatility
      const volatility = this.calculateVolatility(marketData);
      slippage = (this.config.slippageBps / 10000) * (1 + volatility);
    }
    
    // Apply slippage (worse price)
    if (side === 'buy') {
      return targetPrice * (1 + slippage);
    } else {
      return targetPrice * (1 - slippage);
    }
  }

  /**
   * Calculate volatility from recent candles
   * @param {Object} marketData - Market data with recent candles
   */
  calculateVolatility(marketData) {
    if (!marketData.recentCandles || marketData.recentCandles.length < 2) {
      return 0;
    }
    
    const returns = [];
    for (let i = 1; i < marketData.recentCandles.length; i++) {
      const prev = marketData.recentCandles[i - 1].close;
      const curr = marketData.recentCandles[i].close;
      returns.push((curr - prev) / prev);
    }
    
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    
    return Math.sqrt(variance);
  }

  /**
   * Format market data for strategy
   * @param {Object} candle - Current candle
   * @param {Array} allData - All historical data
   * @param {number} index - Current index
   */
  formatMarketData(candle, allData, index) {
    const recentCandles = allData.slice(Math.max(0, index - 20), index + 1);
    
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
      indicators: this.calculateIndicators(recentCandles)
    };
  }

  /**
   * Calculate basic technical indicators
   * @param {Array} candles - Recent candles
   */
  calculateIndicators(candles) {
    const closes = candles.map(c => c.close);
    
    return {
      sma20: this.calculateSMA(closes, 20),
      sma50: this.calculateSMA(closes, 50),
      ema12: this.calculateEMA(closes, 12),
      ema26: this.calculateEMA(closes, 26),
      rsi: this.calculateRSI(closes, 14),
      bb: this.calculateBollingerBands(closes, 20, 2)
    };
  }

  /**
   * Calculate Simple Moving Average
   */
  calculateSMA(data, period) {
    if (data.length < period) return null;
    const sum = data.slice(-period).reduce((a, b) => a + b, 0);
    return sum / period;
  }

  /**
   * Calculate Exponential Moving Average
   */
  calculateEMA(data, period) {
    if (data.length < period) return null;
    
    const k = 2 / (period + 1);
    let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    
    for (let i = period; i < data.length; i++) {
      ema = data[i] * k + ema * (1 - k);
    }
    
    return ema;
  }

  /**
   * Calculate RSI
   */
  calculateRSI(data, period = 14) {
    if (data.length < period + 1) return null;
    
    let gains = 0;
    let losses = 0;
    
    for (let i = 1; i <= period; i++) {
      const change = data[data.length - i] - data[data.length - i - 1];
      if (change > 0) gains += change;
      else losses -= change;
    }
    
    const avgGain = gains / period;
    const avgLoss = losses / period;
    
    if (avgLoss === 0) return 100;
    
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  /**
   * Calculate Bollinger Bands
   */
  calculateBollingerBands(data, period = 20, stdDev = 2) {
    const sma = this.calculateSMA(data, period);
    if (!sma) return null;
    
    const squaredDiffs = data.slice(-period).map(price => Math.pow(price - sma, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period;
    const std = Math.sqrt(variance);
    
    return {
      upper: sma + (stdDev * std),
      middle: sma,
      lower: sma - (stdDev * std)
    };
  }

  /**
   * Record equity at timestamp
   */
  recordEquity(timestamp, currentPrice) {
    let holdingsValue = 0;
    
    for (const [asset, amount] of this.holdings) {
      holdingsValue += amount * currentPrice;
    }
    
    const totalEquity = this.balance + holdingsValue;
    
    this.equityCurve.push({
      timestamp,
      balance: this.balance,
      holdingsValue,
      totalEquity
    });
  }

  /**
   * Calculate backtest results
   */
  calculateResults(historicalData, signals, duration) {
    const initialBalance = this.config.initialBalance;
    const finalBalance = this.balance;
    const totalReturn = ((finalBalance - initialBalance) / initialBalance) * 100;
    
    // Calculate drawdown
    const drawdowns = this.calculateDrawdowns();
    
    // Calculate trade statistics
    const tradeStats = this.calculateTradeStats();
    
    // Calculate Sharpe ratio (simplified)
    const sharpeRatio = this.calculateSharpeRatio();
    
    return {
      summary: {
        initialBalance,
        finalBalance,
        totalReturn,
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

  /**
   * Calculate drawdowns
   */
  calculateDrawdowns() {
    let peak = this.equityCurve[0]?.totalEquity || this.config.initialBalance;
    let maxDrawdown = 0;
    let maxDrawdownPercent = 0;
    const series = [];
    
    for (const point of this.equityCurve) {
      if (point.totalEquity > peak) {
        peak = point.totalEquity;
      }
      
      const drawdown = peak - point.totalEquity;
      const drawdownPercent = (drawdown / peak) * 100;
      
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
        maxDrawdownPercent = drawdownPercent;
      }
      
      series.push({
        timestamp: point.timestamp,
        peak,
        equity: point.totalEquity,
        drawdown,
        drawdownPercent
      });
    }
    
    return {
      maxDrawdown,
      maxDrawdownPercent,
      series
    };
  }

  /**
   * Calculate trade statistics
   */
  calculateTradeStats() {
    const completedTrades = [];
    let currentPosition = null;
    
    // Match buy/sell pairs
    for (const trade of this.trades) {
      if (trade.side === 'buy') {
        currentPosition = trade;
      } else if (trade.side === 'sell' && currentPosition) {
        const pnl = (trade.price - currentPosition.price) * trade.amount;
        const pnlPercent = (pnl / (currentPosition.price * trade.amount)) * 100;
        
        completedTrades.push({
          entry: currentPosition,
          exit: trade,
          pnl,
          pnlPercent,
          duration: trade.timestamp - currentPosition.timestamp
        });
        
        currentPosition = null;
      }
    }
    
    if (completedTrades.length === 0) {
      return {
        winningTrades: 0,
        losingTrades: 0,
        winRate: 0,
        avgWin: 0,
        avgLoss: 0,
        profitFactor: 0
      };
    }
    
    const winners = completedTrades.filter(t => t.pnl > 0);
    const losers = completedTrades.filter(t => t.pnl <= 0);
    
    const totalWin = winners.reduce((sum, t) => sum + t.pnl, 0);
    const totalLoss = Math.abs(losers.reduce((sum, t) => sum + t.pnl, 0));
    
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
   * Calculate Sharpe ratio
   */
  calculateSharpeRatio() {
    if (this.equityCurve.length < 2) return 0;
    
    const returns = [];
    for (let i = 1; i < this.equityCurve.length; i++) {
      const prev = this.equityCurve[i - 1].totalEquity;
      const curr = this.equityCurve[i].totalEquity;
      returns.push((curr - prev) / prev);
    }
    
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    
    // Annualized Sharpe (assuming daily data, 252 trading days)
    if (stdDev === 0) return 0;
    return (mean * 252) / (stdDev * Math.sqrt(252));
  }

  /**
   * Reset backtest state
   */
  reset() {
    this.results = null;
    this.trades = [];
    this.equityCurve = [];
    this.positions.clear();
    this.balance = this.config.initialBalance;
    this.holdings.clear();
  }

  /**
   * Get current results
   */
  getResults() {
    return this.results;
  }

  /**
   * Export results to JSON
   */
  exportResults() {
    return JSON.stringify(this.results, null, 2);
  }
}

module.exports = BacktestEngine;
