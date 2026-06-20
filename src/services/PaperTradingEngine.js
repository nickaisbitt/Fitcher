const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

/**
 * PaperTradingEngine - Full paper trading simulation with historical replay
 * Simulates realistic trading with proper fills, slippage, and fees
 */
class PaperTradingEngine {
  constructor(config = {}) {
    this.config = {
      initialBalance: config.initialBalance ?? 100000, // $100k USD
      baseCurrency: config.baseCurrency || 'USD',
      tradingPairs: config.tradingPairs || ['BTC/USD', 'ETH/USD'],
      
      // Simulation parameters
      slippageModel: config.slippageModel || 'variable', // 'fixed' | 'variable'
      baseSlippage: config.baseSlippage ?? 0.001, // 0.1%
      maxSlippage: config.maxSlippage ?? 0.005, // 0.5%
      
      // Fee simulation (Kraken-like)
      makerFee: config.makerFee ?? 0.0016, // 0.16%
      takerFee: config.takerFee ?? 0.0026, // 0.26%
      
      // Latency simulation
      latencyMs: config.latencyMs ?? 500,
      latencyVariance: config.latencyVariance ?? 0.5,
      
      // Partial fill simulation
      partialFillProbability: config.partialFillProbability ?? 0.3,
      
      // Hard stop-loss (research: -3% hard stop prevents catastrophic losses)
      maxLossPercent: config.maxLossPercent ?? 3.0, // 3% max loss per trade
      
      // Trailing stop enabled
      useTrailingStop: config.useTrailingStop !== false,
      
      ...config
    };
    
    // Portfolio state
    this.balance = {
      [this.config.baseCurrency]: this.config.initialBalance
    };
    this.positions = new Map(); // pair -> { amount, avgPrice, unrealizedPnl }
    
    // Order management
    this.orders = new Map();
    this.orderHistory = [];
    this.trades = [];
    
    // Performance tracking
    this.startTime = null;
    this.endTime = null;
    this.initialPortfolioValue = this.config.initialBalance;
    this.peakValue = this.config.initialBalance;
    this.maxDrawdown = 0;
    
    // Current market data
    this.currentPrices = new Map();
    this.priceHistory = new Map(); // For calculating volatility
  }

  /**
   * Initialize paper trading session
   */
  async initialize() {
    logger.info('Initializing Paper Trading Engine...');
    logger.info(`Initial balance: $${this.config.initialBalance.toFixed(2)} ${this.config.baseCurrency}`);
    logger.info(`Trading pairs: ${this.config.tradingPairs.join(', ')}`);
    
    this.startTime = Date.now();
    
    // Initialize positions
    for (const pair of this.config.tradingPairs) {
      this.positions.set(pair, {
        amount: 0,
        avgPrice: 0,
        unrealizedPnl: 0,
        realizedPnl: 0
      });
      this.priceHistory.set(pair, []);
    }
    
    return true;
  }

  /**
   * Process a candle through the trading system
   * This simulates one time step in historical replay
   */
  async processCandle(candle, strategies = []) {
    const { pair, timestamp, open, high, low, close, volume } = candle;
    
    // Update current price
    this.currentPrices.set(pair, close);
    
    // Update price history
    const history = this.priceHistory.get(pair) || [];
    history.push({ timestamp, price: close, volume });
    if (history.length > 100) history.shift();
    this.priceHistory.set(pair, history);
    
    // Update position PnL
    this.updatePositionPnL(pair, close);
    
    // Check for hard stop-loss (research: -3% hard stop prevents catastrophic losses)
    await this.checkHardStops(pair, close);
    
    // Check for open order fills
    await this.checkOpenOrders(pair, candle);
    
    // Generate signals from strategies
    const marketData = {
      pair,
      price: close,
      open,
      high,
      low,
      volume,
      timestamp,
      currentPrices: Object.fromEntries(this.currentPrices)
    };
    
    const signals = [];
    for (const strategy of strategies) {
      try {
        // Update strategy with candle
        if (strategy.update) {
          strategy.update(candle, pair);
        }
        
        // Generate signal
        if (strategy.generateSignal) {
          const signal = await strategy.generateSignal(marketData);
          if (signal && signal.action !== 'hold') {
            signals.push(signal);
          }
        }
      } catch (error) {
        logger.error(`Strategy error for ${pair}:`, error.message);
      }
    }
    
    // Return signals for potential execution
    return signals;
  }

  /**
   * Execute a paper trade
   */
  async executeTrade(signal) {
    try {
      const { pair, amount, price, orderType = 'market' } = signal;
      const side = signal.side || signal.action; // Support both side and action
      const currentPrice = this.currentPrices.get(pair);
      
      logger.debug(`Executing ${side} on ${pair}. Balance: ${JSON.stringify(this.balance)}`);
      
      if (!currentPrice) {
        throw new Error(`No price data for ${pair}`);
      }
      
      // Calculate fill price with slippage
      const fillPrice = this.calculateFillPrice(currentPrice, side, orderType, signal);
      
      // Simulate latency
      await this.simulateLatency();
      
      // Calculate fees
      const isMaker = orderType === 'limit';
      const feeRate = isMaker ? this.config.makerFee : this.config.takerFee;
      const orderValue = amount * fillPrice;
      const fee = orderValue * feeRate;
      
      // Validate balance
      const baseCurrency = pair.split('/')[0];
      const quoteCurrency = pair.split('/')[1] || 'USD';
      
      let realizedPnl = 0;
      
      if (side === 'buy') {
        const totalCost = orderValue + fee;
        const currentBalance = this.balance[quoteCurrency] || 0;
        
        if (totalCost > currentBalance) {
          throw new Error(`Insufficient ${quoteCurrency} balance. Need: ${totalCost.toFixed(2)}, Have: ${currentBalance.toFixed(2)}`);
        }
        
        // Update balance
        this.balance[quoteCurrency] = currentBalance - totalCost;
        
        // Update position
        const position = this.positions.get(pair) || { amount: 0, avgPrice: 0 };
        const newAmount = position.amount + amount;
        position.avgPrice = ((position.amount * position.avgPrice) + (amount * fillPrice)) / newAmount;
        position.amount = newAmount;
        this.positions.set(pair, position);
        
      } else { // sell
        const position = this.positions.get(pair);
        const currentPositionAmount = position?.amount || 0;
        
        if (!position || currentPositionAmount < amount) {
          throw new Error(`Insufficient ${baseCurrency} position. Need: ${amount}, Have: ${currentPositionAmount.toFixed(8)}`);
        }
        
        const proceeds = orderValue - fee;
        
        // Calculate realized PnL BEFORE updating position
        const avgPriceAtSale = position.avgPrice;
        realizedPnl = (fillPrice - avgPriceAtSale) * amount - fee;
        
        // Update balance
        this.balance[quoteCurrency] = (this.balance[quoteCurrency] || 0) + proceeds;
        
        // Update position
        position.amount -= amount;
        if (position.amount === 0) {
          position.avgPrice = 0;
        }
        
        position.realizedPnl = (position.realizedPnl || 0) + realizedPnl;
        
        this.positions.set(pair, position);
      }
      
      // Record trade (for both buy and sell)
      const trade = {
        id: `paper_${uuidv4()}`,
        timestamp: Date.now(),
        pair,
        side,
        amount,
        price: fillPrice,
        orderValue,
        fee,
        feeRate,
        realizedPnl: side === 'sell' ? realizedPnl : 0,
        slippage: ((fillPrice - currentPrice) / currentPrice) * 100,
        balanceAfter: { ...this.balance },
        signal
      };
      
      this.trades.push(trade);
      
      // Update drawdown tracking
      this.updateDrawdown();
      
      logger.info(`Paper trade executed: ${side} ${amount} ${pair} @ ${fillPrice.toFixed(2)} (fee: ${fee.toFixed(2)})`);
      
      return trade;
      
    } catch (error) {
      if (!this.config.suppressExecutionErrors) {
        logger.error('Paper trade execution failed:', error.message);
      }
      throw error;
    }
  }

  /**
   * Create a paper order (for limit orders)
   */
  async createOrder(orderParams) {
    const { pair, side, amount, price, type } = orderParams;
    
    const order = {
      id: `paper_order_${uuidv4()}`,
      pair,
      side,
      amount,
      price,
      type,
      status: 'open',
      filled: 0,
      remaining: amount,
      createdAt: Date.now(),
      trades: []
    };
    
    this.orders.set(order.id, order);
    
    // If market order, fill immediately
    if (type === 'market') {
      await this.fillOrder(order, this.currentPrices.get(pair));
    }
    
    return order;
  }

  /**
   * Check open orders for fills
   */
  async checkOpenOrders(pair, candle) {
    for (const [orderId, order] of this.orders) {
      if (order.pair !== pair || order.status !== 'open') continue;
      
      // Check if price crossed limit
      let shouldFill = false;
      let fillPrice = order.price;
      
      if (order.side === 'buy' && candle.low <= order.price) {
        shouldFill = true;
        fillPrice = Math.min(order.price, candle.open); // Fill at better price
      } else if (order.side === 'sell' && candle.high >= order.price) {
        shouldFill = true;
        fillPrice = Math.max(order.price, candle.open);
      }
      
      if (shouldFill) {
        // Simulate partial fills
        const fillAmount = this.shouldPartialFill() 
          ? order.remaining * (0.3 + Math.random() * 0.4) // 30-70% fill
          : order.remaining;
        
        await this.fillOrder(order, fillPrice, fillAmount);
      }
    }
  }

  /**
   * Fill an order
   */
  async fillOrder(order, price, amount = null) {
    const fillAmount = amount || order.remaining;
    const orderValue = fillAmount * price;
    const isMaker = order.type === 'limit';
    const feeRate = isMaker ? this.config.makerFee : this.config.takerFee;
    const fee = orderValue * feeRate;
    
    const pair = order.pair;
    const baseCurrency = pair.split('/')[0];
    const quoteCurrency = pair.split('/')[1] || 'USDT';
    
    let tradeRealizedPnl = 0;

    if (order.side === 'buy') {
      const totalCost = orderValue + fee;
      this.balance[quoteCurrency] = (this.balance[quoteCurrency] || 0) - totalCost;
      
      const position = this.positions.get(pair) || { amount: 0, avgPrice: 0 };
      const newAmount = position.amount + fillAmount;
      position.avgPrice = ((position.amount * position.avgPrice) + (fillAmount * price)) / newAmount;
      position.amount = newAmount;
      this.positions.set(pair, position);
    } else {
      const position = this.positions.get(pair);
      if (position) {
        const proceeds = orderValue - fee;
        this.balance[quoteCurrency] = (this.balance[quoteCurrency] || 0) + proceeds;
        
        tradeRealizedPnl = (price - position.avgPrice) * fillAmount - fee;
        position.realizedPnl = (position.realizedPnl || 0) + tradeRealizedPnl;
        position.amount -= fillAmount;
        if (position.amount <= 0.000001) {
          position.amount = 0;
          position.avgPrice = 0;
        }
        this.positions.set(pair, position);
      }
    }

    const trade = {
      id: `paper_${uuidv4()}`,
      orderId: order.id,
      timestamp: Date.now(),
      pair: order.pair,
      side: order.side,
      amount: fillAmount,
      price,
      orderValue,
      fee,
      feeRate,
      realizedPnl: order.side === 'sell' ? tradeRealizedPnl : 0,
      slippage: 0
    };
    
    order.trades.push(trade);
    order.filled += fillAmount;
    order.remaining -= fillAmount;
    
    if (order.remaining <= 0.000001) {
      order.status = 'filled';
    } else {
      order.status = 'partial';
    }
    
    this.trades.push(trade);
    this.orderHistory.push(order);
    
    logger.info(`Paper order filled: ${order.side} ${fillAmount} ${order.pair} @ ${price.toFixed(2)} (P&L: ${tradeRealizedPnl.toFixed(2)})`);
  }

  /**
   * Calculate fill price with realistic slippage
   */
  calculateFillPrice(marketPrice, side, orderType, signal) {
    let slippage = this.config.baseSlippage;
    
    if (this.config.slippageModel === 'variable') {
      // Variable slippage based on:
      // 1. Order size
      const orderValue = signal.amount * marketPrice;
      if (orderValue > 10000) slippage *= 1.5;
      if (orderValue > 50000) slippage *= 2.0;
      
      // 2. Volatility
      const volatility = signal.volatility || 0.02;
      slippage *= (1 + volatility * 10);
      
      // 3. Random variance
      slippage *= (0.8 + Math.random() * 0.4);
    }
    
    // Cap slippage
    slippage = Math.min(slippage, this.config.maxSlippage);
    
    // Apply slippage
    if (side === 'buy') {
      return marketPrice * (1 + slippage);
    } else {
      return marketPrice * (1 - slippage);
    }
  }

  /**
   * Simulate network latency
   */
  async simulateLatency() {
    if (!this.config.latencyMs || this.config.latencyMs <= 0) {
      return;
    }
    const variance = this.config.latencyVariance;
    const latency = this.config.latencyMs * (1 - variance + Math.random() * variance * 2);
    await new Promise(resolve => setTimeout(resolve, latency));
  }

  /**
   * Determine if order should partially fill
   */
  shouldPartialFill() {
    return Math.random() < this.config.partialFillProbability;
  }

  /**
   * Update position unrealized PnL
   */
  updatePositionPnL(pair, currentPrice) {
    const position = this.positions.get(pair);
    if (!position || position.amount === 0) return;
    
    const unrealizedPnl = (currentPrice - position.avgPrice) * position.amount;
    position.unrealizedPnl = unrealizedPnl;
    this.positions.set(pair, position);
  }

  /**
   * Check and execute hard stop-losses
   * Research shows -3% hard stop prevents catastrophic drawdowns
   */
  async checkHardStops(pair, currentPrice) {
    const position = this.positions.get(pair);
    if (!position || position.amount === 0 || !position.avgPrice) return;
    
    const lossPercent = ((currentPrice - position.avgPrice) / position.avgPrice) * 100;
    
    // If loss exceeds hard stop threshold, force sell
    if (lossPercent <= -this.config.maxLossPercent) {
      logger.warn(`HARD STOP TRIGGERED: ${pair} down ${lossPercent.toFixed(2)}% from ${position.avgPrice.toFixed(2)}`);
      
      try {
        await this.executeTrade({
          pair,
          side: 'sell',
          amount: position.amount,
          price: currentPrice,
          reason: 'hard_stop'
        });
        logger.info(`HARD STOP SELL: Closed ${position.amount} ${pair} @ ${currentPrice.toFixed(2)}`);
      } catch (error) {
        logger.error(`Hard stop failed: ${error.message}`);
      }
    }
  }

  /**
   * Update drawdown tracking
   */
  updateDrawdown() {
    const currentValue = this.getPortfolioValue();
    
    if (currentValue > this.peakValue) {
      this.peakValue = currentValue;
    }
    
    const drawdown = (this.peakValue - currentValue) / this.peakValue;
    if (drawdown > this.maxDrawdown) {
      this.maxDrawdown = drawdown;
    }
  }

  /**
   * Get current portfolio value
   */
  getPortfolioValue() {
    let totalValue = this.balance[this.config.baseCurrency] || 0;
    
    for (const [pair, position] of this.positions) {
      const currentPrice = this.currentPrices.get(pair);
      if (currentPrice && position.amount > 0) {
        totalValue += position.amount * currentPrice;
      }
    }
    
    return totalValue;
  }

  /**
   * Get performance metrics
   */
  getPerformance() {
    const currentValue = this.getPortfolioValue();
    const totalReturn = ((currentValue - this.initialPortfolioValue) / this.initialPortfolioValue) * 100;
    
    // Calculate win rate
    const sellTrades = this.trades.filter(t => t.side === 'sell');
    const completedTrades = sellTrades.filter(t => t.amount > 0);
    
    const winningTrades = completedTrades.filter(t => t.realizedPnl > 0);
    
    const winRate = completedTrades.length > 0 
      ? (winningTrades.length / completedTrades.length) * 100 
      : 0;
    
    // Calculate Sharpe ratio (simplified)
    const returns = this.calculateReturns();
    const sharpeRatio = this.calculateSharpeRatio(returns);
    
    return {
      initialBalance: this.config.initialBalance,
      currentValue,
      totalReturn,
      totalReturnUsd: currentValue - this.initialPortfolioValue,
      maxDrawdown: this.maxDrawdown * 100,
      winRate,
      totalTrades: completedTrades.length,
      sharpeRatio,
      positions: Object.fromEntries(this.positions),
      balance: { ...this.balance },
      duration: this.startTime ? Date.now() - this.startTime : 0
    };
  }

  /**
   * Calculate daily returns for Sharpe ratio
   */
  calculateReturns() {
    // Group trades by day and calculate daily returns
    const dailyValues = new Map();
    
    for (const trade of this.trades) {
      const date = new Date(trade.timestamp).toDateString();
      const value = this.getPortfolioValueAtTime(trade.timestamp);
      dailyValues.set(date, value);
    }
    
    const values = Array.from(dailyValues.values());
    const returns = [];
    
    for (let i = 1; i < values.length; i++) {
      returns.push((values[i] - values[i-1]) / values[i-1]);
    }
    
    return returns;
  }

  /**
   * Calculate Sharpe ratio
   */
  calculateSharpeRatio(returns) {
    if (returns.length < 2) return 0;
    
    // ⚡ Bolt Optimization: Use Welford's online algorithm to compute mean and variance
    // in a single pass instead of looping multiple times with .reduce().
    let mean = 0;
    let m2 = 0;
    for (let i = 0; i < returns.length; i++) {
      const x = returns[i];
      const count = i + 1;
      const delta = x - mean;
      mean += delta / count;
      const delta2 = x - mean;
      m2 += delta * delta2;
    }
    const variance = returns.length > 1 ? m2 / returns.length : 0;
    const stdDev = Math.sqrt(variance);
    
    if (stdDev === 0) return 0;
    
    // Annualized Sharpe (assuming daily returns)
    return (mean / stdDev) * Math.sqrt(365);
  }

  /**
   * Get portfolio value at specific time (approximation)
   */
  getPortfolioValueAtTime(timestamp) {
    // Simplified: return current value
    return this.getPortfolioValue();
  }

  /**
   * Reset paper trading session
   */
  reset() {
    this.balance = {
      [this.config.baseCurrency]: this.config.initialBalance
    };
    this.positions.clear();
    this.orders.clear();
    this.trades = [];
    this.orderHistory = [];
    this.currentPrices.clear();
    this.startTime = null;
    this.peakValue = this.config.initialBalance;
    this.maxDrawdown = 0;
    
    logger.info('Paper trading session reset');
  }

  /**
   * Generate detailed report
   */
  generateReport() {
    const performance = this.getPerformance();
    
    return {
      summary: performance,
      trades: this.trades,
      positions: Array.from(this.positions.entries()),
      orders: this.orderHistory,
      config: this.config
    };
  }
}

module.exports = PaperTradingEngine;
