const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

class TradingStrategy {
  constructor(config) {
    this.id = config.id || uuidv4();
    this.userId = config.userId;
    this.name = config.name;
    this.description = config.description || '';
    this.type = config.type; // 'momentum', 'mean_reversion', 'grid', 'dca', 'custom'
    this.status = 'inactive'; // inactive, active, paused, error
    
    // Strategy parameters
    this.parameters = config.parameters || {};
    
    // Trading settings
    this.exchange = config.exchange || 'kraken';
    this.pair = config.pair;
    this.side = config.side || 'buy'; // 'buy', 'sell', 'both'
    
    // Risk settings
    this.maxPositionSize = config.maxPositionSize || 0.1; // 10% of portfolio
    this.maxDailyTrades = config.maxDailyTrades || 10;
    this.stopLoss = config.stopLoss || null; // percentage
    this.takeProfit = config.takeProfit || null; // percentage
    
    // Execution settings
    this.orderType = config.orderType || 'limit'; // 'market', 'limit'
    this.timeInForce = config.timeInForce || 'GTC';
    
    // State
    this.trades = [];
    this.signals = [];
    this.performance = {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      totalPnL: 0,
      winRate: 0,
      avgWin: 0,
      avgLoss: 0,
      profitFactor: 0
    };
    
    this.createdAt = new Date();
    this.updatedAt = new Date();
    this.lastRunAt = null;
    this.error = null;
  }

  // Activate strategy
  activate() {
    if (this.status === 'active') {
      return { success: false, error: 'Strategy is already active' };
    }
    
    this.status = 'active';
    this.updatedAt = new Date();
    this.error = null;
    
    logger.info(`Strategy ${this.id} (${this.name}) activated`);
    
    return { success: true, message: 'Strategy activated' };
  }

  // Deactivate strategy
  deactivate() {
    this.status = 'inactive';
    this.updatedAt = new Date();
    
    logger.info(`Strategy ${this.id} (${this.name}) deactivated`);
    
    return { success: true, message: 'Strategy deactivated' };
  }

  // Pause strategy
  pause() {
    if (this.status !== 'active') {
      return { success: false, error: 'Strategy must be active to pause' };
    }
    
    this.status = 'paused';
    this.updatedAt = new Date();
    
    logger.info(`Strategy ${this.id} (${this.name}) paused`);
    
    return { success: true, message: 'Strategy paused' };
  }

  // Resume strategy
  resume() {
    if (this.status !== 'paused') {
      return { success: false, error: 'Strategy must be paused to resume' };
    }
    
    this.status = 'active';
    this.updatedAt = new Date();
    
    logger.info(`Strategy ${this.id} (${this.name}) resumed`);
    
    return { success: true, message: 'Strategy resumed' };
  }

  // Execute strategy logic (to be implemented by subclasses)
  async execute(marketData) {
    if (this.status !== 'active') {
      return { success: false, error: 'Strategy is not active' };
    }

    try {
      this.lastRunAt = new Date();
      
      // Check if we've hit daily trade limit
      const todayTrades = this.trades.filter(t => {
        const tradeDate = new Date(t.timestamp).toDateString();
        return tradeDate === new Date().toDateString();
      });
      
      if (todayTrades.length >= this.maxDailyTrades) {
        return { success: false, error: 'Daily trade limit reached' };
      }

      // Generate trading signal
      const signal = await this.generateSignal(marketData);
      
      if (signal.action === 'hold') {
        return { success: true, action: 'hold', message: 'No signal generated' };
      }

      // Validate signal
      const validation = this.validateSignal(signal);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      // Record signal
      this.signals.push({
        ...signal,
        timestamp: new Date(),
        marketData
      });

      logger.info(`Strategy ${this.id} generated ${signal.action} signal`, signal);

      return {
        success: true,
        action: signal.action,
        signal: signal
      };

    } catch (error) {
      this.status = 'error';
      this.error = error.message;
      logger.error(`Strategy ${this.id} execution error:`, error);
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Generate trading signal (to be implemented by subclasses)
  async generateSignal(marketData) {
    // Base implementation - subclasses should override
    return {
      action: 'hold', // 'buy', 'sell', 'hold'
      confidence: 0,
      reason: 'Base strategy - no signal'
    };
  }

  // Validate trading signal
  validateSignal(signal) {
    if (!['buy', 'sell', 'hold'].includes(signal.action)) {
      return { valid: false, error: 'Invalid signal action' };
    }

    if (signal.action === 'hold') {
      return { valid: true };
    }

    if (!signal.price || signal.price <= 0) {
      return { valid: false, error: 'Invalid signal price' };
    }

    if (!signal.amount || signal.amount <= 0) {
      return { valid: false, error: 'Invalid signal amount' };
    }

    return { valid: true };
  }

  // Record trade result
  recordTrade(trade) {
    this.trades.push({
      ...trade,
      strategyId: this.id,
      timestamp: trade.timestamp || new Date()
    });

    // Update performance metrics
    this.updatePerformance();
    
    this.updatedAt = new Date();
  }

  // Update performance metrics
  updatePerformance() {
    const completedTrades = this.trades.filter(t => t.status === 'filled');
    
    this.performance.totalTrades = completedTrades.length;
    
    let winningTrades = 0;
    let losingTrades = 0;
    let totalWinAmount = 0;
    let totalLossAmount = 0;
    let totalPnL = 0;

    for (const trade of completedTrades) {
      const pnl = trade.realizedPnL || 0;
      totalPnL += pnl;
      
      if (pnl > 0) {
        winningTrades++;
        totalWinAmount += pnl;
      } else if (pnl < 0) {
        losingTrades++;
        totalLossAmount += Math.abs(pnl);
      }
    }

    this.performance.winningTrades = winningTrades;
    this.performance.losingTrades = losingTrades;
    this.performance.totalPnL = totalPnL;
    
    this.performance.winRate = this.performance.totalTrades > 0 
      ? (winningTrades / this.performance.totalTrades) * 100 
      : 0;
    
    this.performance.avgWin = winningTrades > 0 
      ? totalWinAmount / winningTrades 
      : 0;
    
    this.performance.avgLoss = losingTrades > 0 
      ? totalLossAmount / losingTrades 
      : 0;
    
    this.performance.profitFactor = totalLossAmount > 0 
      ? totalWinAmount / totalLossAmount 
      : 0;
  }

  // Get strategy summary
  getSummary() {
    return {
      id: this.id,
      userId: this.userId,
      name: this.name,
      description: this.description,
      type: this.type,
      status: this.status,
      pair: this.pair,
      exchange: this.exchange,
      side: this.side,
      parameters: this.parameters,
      performance: this.performance,
      tradeCount: this.trades.length,
      signalCount: this.signals.length,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      lastRunAt: this.lastRunAt,
      error: this.error
    };
  }

  // Get detailed performance report
  getPerformanceReport() {
    const tradesByDay = {};
    const tradesByMonth = {};
    
    for (const trade of this.trades) {
      const date = new Date(trade.timestamp);
      const day = date.toDateString();
      const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      
      if (!tradesByDay[day]) {
        tradesByDay[day] = { trades: 0, pnl: 0 };
      }
      tradesByDay[day].trades++;
      tradesByDay[day].pnl += trade.realizedPnL || 0;
      
      if (!tradesByMonth[month]) {
        tradesByMonth[month] = { trades: 0, pnl: 0 };
      }
      tradesByMonth[month].trades++;
      tradesByMonth[month].pnl += trade.realizedPnL || 0;
    }

    return {
      strategy: this.getSummary(),
      dailyPerformance: tradesByDay,
      monthlyPerformance: tradesByMonth,
      recentTrades: this.trades.slice(-10),
      recentSignals: this.signals.slice(-10)
    };
  }

  // Update strategy parameters
  updateParameters(newParameters) {
    this.parameters = { ...this.parameters, ...newParameters };
    this.updatedAt = new Date();
    
    logger.info(`Strategy ${this.id} parameters updated`, this.parameters);
    
    return { success: true, message: 'Parameters updated' };
  }

  // Reset strategy (clear trades and signals)
  reset() {
    this.trades = [];
    this.signals = [];
    this.performance = {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      totalPnL: 0,
      winRate: 0,
      avgWin: 0,
      avgLoss: 0,
      profitFactor: 0
    };
    this.updatedAt = new Date();
    
    logger.info(`Strategy ${this.id} reset`);
    
    return { success: true, message: 'Strategy reset' };
  }
}

module.exports = TradingStrategy;