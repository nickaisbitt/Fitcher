const EventEmitter = require('events');
const logger = require('../utils/logger');
const eventBus = require('../utils/eventBus');

/**
 * EnhancedRiskManager - Advanced risk management system
 * Monitors portfolio risk, enforces limits, and triggers circuit breakers
 */
class EnhancedRiskManager extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      // Portfolio limits
      maxPositionSize: config.maxPositionSize || 0.2, // 20% per position
      maxTotalExposure: config.maxTotalExposure || 0.8, // 80% total
      maxConcentration: config.maxConcentration || 0.4, // 40% per asset
      
      // Daily limits
      maxDailyLoss: config.maxDailyLoss || 0.05, // 5% max daily loss
      maxDailyTrades: config.maxDailyTrades || 100,
      maxDailyVolume: config.maxDailyVolume || 100000, // USD
      
      // Drawdown limits
      maxDrawdownPercent: config.maxDrawdownPercent || 10, // 10% max drawdown
      maxConsecutiveLosses: config.maxConsecutiveLosses || 5,
      
      // Circuit breaker
      circuitBreakerThreshold: config.circuitBreakerThreshold || 0.1,
      circuitBreakerDuration: config.circuitBreakerDuration || 3600000, // 1 hour
      
      // Cooldowns
      tradeCooldownMs: config.tradeCooldownMs || 1000,
      strategyCooldownMs: config.strategyCooldownMs || 60000, // 1 min after loss
      
      // Price protection
      maxSlippagePercent: config.maxSlippagePercent || 2,
      maxPriceDeviationPercent: config.maxPriceDeviationPercent || 5,
      
      ...config
    };
    
    this.userData = new Map(); // userId -> risk data
    this.circuitBreakers = new Map(); // userId -> breaker status
    this.peakEquity = new Map(); // userId -> peak equity
    this.consecutiveLosses = new Map(); // userId -> count
    
    this.setupEventHandlers();
  }

  /**
   * Setup event handlers
   */
  setupEventHandlers() {
    // Listen for trade events
    eventBus.subscribe('trading:orderFilled', (data) => {
      this.handleTrade(data);
    });
    
    // Listen for circuit breaker events
    eventBus.subscribe('trading:circuitBreaker', (data) => {
      logger.error(`Circuit breaker triggered for user ${data.userId}`);
    });
  }

  /**
   * Initialize user risk tracking
   * @param {string} userId - User ID
   * @param {number} initialEquity - Initial equity
   */
  initializeUser(userId, initialEquity = 100000) {
    if (!this.userData.has(userId)) {
      this.userData.set(userId, {
        dailyStats: this.createDailyStats(),
        positions: new Map(),
        lastTradeTime: null,
        strategyLastTrade: new Map(),
        totalTrades: 0,
        totalVolume: 0,
        realizedPnL: 0,
        initialEquity
      });
      
      this.peakEquity.set(userId, initialEquity);
      this.consecutiveLosses.set(userId, 0);
    }
  }

  /**
   * Create fresh daily stats
   */
  createDailyStats() {
    return {
      date: new Date().toDateString(),
      tradeCount: 0,
      volume: 0,
      fees: 0,
      realizedPnL: 0,
      trades: []
    };
  }

  /**
   * Check if trade is allowed
   * @param {string} userId - User ID
   * @param {Object} tradeParams - Trade parameters
   * @param {Object} portfolio - Portfolio state
   */
  async checkTrade(userId, tradeParams, portfolio = {}) {
    this.initializeUser(userId, portfolio.totalValue);
    
    const checks = {
      circuitBreaker: this.checkCircuitBreaker(userId),
      dailyLimits: this.checkDailyLimits(userId, tradeParams),
      positionSize: this.checkPositionSize(userId, tradeParams, portfolio),
      exposure: this.checkTotalExposure(userId, tradeParams, portfolio),
      concentration: this.checkConcentration(userId, tradeParams, portfolio),
      cooldown: this.checkCooldown(userId),
      drawdown: this.checkDrawdown(userId, portfolio),
      consecutiveLosses: this.checkConsecutiveLosses(userId),
      slippage: this.checkSlippage(tradeParams),
      priceDeviation: this.checkPriceDeviation(tradeParams)
    };
    
    const failed = Object.entries(checks)
      .filter(([_, result]) => !result.allowed)
      .map(([name, result]) => ({ check: name, ...result }));
    
    const allowed = failed.length === 0;
    
    if (!allowed) {
      logger.warn(`Risk check failed for user ${userId}:`, failed);

      this.emit('riskCheckFailed', {
        userId,
        tradeParams,
        failedChecks: failed,
        timestamp: Date.now()
      });
      
      // Check if we should trigger circuit breaker
      const criticalFailures = failed.filter(f => 
        ['drawdown', 'consecutiveLosses', 'dailyLimits'].includes(f.check)
      );
      
      if (criticalFailures.length > 0) {
        this.triggerCircuitBreaker(userId, criticalFailures);
      }
      
      eventBus.publish('risk:checkFailed', {
        userId,
        tradeParams,
        failedChecks: failed,
        timestamp: Date.now()
      });
    }
    
    return {
      allowed,
      checks,
      failedChecks: failed,
      timestamp: Date.now()
    };
  }

  /**
   * Check circuit breaker status
   * @param {string} userId - User ID
   */
  checkCircuitBreaker(userId) {
    const breaker = this.circuitBreakers.get(userId);
    
    if (breaker?.active) {
      const elapsed = Date.now() - breaker.triggeredAt;
      
      if (elapsed < this.config.circuitBreakerDuration) {
        const remaining = this.config.circuitBreakerDuration - elapsed;
        return {
          allowed: false,
          reason: `Circuit breaker active. ${Math.ceil(remaining / 60000)} minutes remaining`,
          triggeredAt: breaker.triggeredAt,
          remaining
        };
      } else {
        // Reset expired breaker
        this.circuitBreakers.delete(userId);
        logger.info(`Circuit breaker expired for user ${userId}`);
        
        eventBus.publish('risk:circuitBreakerReset', { userId });
      }
    }
    
    return { allowed: true };
  }

  /**
   * Check daily trading limits
   * @param {string} userId - User ID
   * @param {Object} tradeParams - Trade parameters
   */
  checkDailyLimits(userId, tradeParams) {
    const userData = this.userData.get(userId);
    const stats = userData.dailyStats;
    
    // Reset if new day
    if (stats.date !== new Date().toDateString()) {
      userData.dailyStats = this.createDailyStats();
    }
    
    const tradeValue = (tradeParams.amount || 0) * (tradeParams.price || 0);
    
    // Check daily loss
    const dailyLoss = Math.abs(Math.min(0, stats.realizedPnL));
    const maxLoss = (userData.initialEquity || 100000) * this.config.maxDailyLoss;
    
    if (dailyLoss >= maxLoss) {
      return {
        allowed: false,
        reason: `Daily loss limit reached: $${dailyLoss.toFixed(2)} / $${maxLoss.toFixed(2)}`,
        current: dailyLoss,
        limit: maxLoss
      };
    }
    
    // Check trade count
    if (stats.tradeCount >= this.config.maxDailyTrades) {
      return {
        allowed: false,
        reason: `Daily trade limit reached: ${stats.tradeCount} / ${this.config.maxDailyTrades}`,
        current: stats.tradeCount,
        limit: this.config.maxDailyTrades
      };
    }
    
    // Check volume
    if (stats.volume + tradeValue > this.config.maxDailyVolume) {
      return {
        allowed: false,
        reason: `Daily volume limit would be exceeded: $${(stats.volume + tradeValue).toFixed(2)} / $${this.config.maxDailyVolume}`,
        current: stats.volume,
        projected: stats.volume + tradeValue,
        limit: this.config.maxDailyVolume
      };
    }
    
    return { allowed: true };
  }

  /**
   * Check position size limits
   * @param {string} userId - User ID
   * @param {Object} tradeParams - Trade parameters
   * @param {Object} portfolio - Portfolio state
   */
  checkPositionSize(userId, tradeParams, portfolio) {
    const tradeValue = (tradeParams.amount || 0) * (tradeParams.price || 0);
    const portfolioValue = portfolio.totalValue || 100000;
    const positionRatio = tradeValue / portfolioValue;
    
    if (positionRatio > this.config.maxPositionSize) {
      return {
        allowed: false,
        reason: `Position size ${(positionRatio * 100).toFixed(2)}% exceeds maximum ${(this.config.maxPositionSize * 100).toFixed(2)}%`,
        current: positionRatio,
        limit: this.config.maxPositionSize
      };
    }
    
    return { allowed: true };
  }

  /**
   * Check total exposure limits
   * @param {string} userId - User ID
   * @param {Object} tradeParams - Trade parameters
   * @param {Object} portfolio - Portfolio state
   */
  checkTotalExposure(userId, tradeParams, portfolio) {
    const currentExposure = portfolio.totalExposure || 0;
    const tradeValue = (tradeParams.amount || 0) * (tradeParams.price || 0);
    const newExposure = currentExposure + tradeValue;
    const portfolioValue = portfolio.totalValue || 100000;
    const exposureRatio = newExposure / portfolioValue;
    
    if (exposureRatio > this.config.maxTotalExposure) {
      return {
        allowed: false,
        reason: `Total exposure ${(exposureRatio * 100).toFixed(2)}% exceeds maximum ${(this.config.maxTotalExposure * 100).toFixed(2)}%`,
        current: exposureRatio,
        limit: this.config.maxTotalExposure
      };
    }
    
    return { allowed: true };
  }

  /**
   * Check asset concentration limits
   * @param {string} userId - User ID
   * @param {Object} tradeParams - Trade parameters
   * @param {Object} portfolio - Portfolio state
   */
  checkConcentration(userId, tradeParams, portfolio) {
    const asset = tradeParams.pair?.split('/')[0];
    if (!asset) return { allowed: true };
    
    const currentPosition = portfolio.positions?.find(p => p.asset === asset);
    const currentValue = currentPosition?.totalValue || 0;
    const tradeValue = (tradeParams.amount || 0) * (tradeParams.price || 0);
    const newValue = currentValue + tradeValue;
    
    const portfolioValue = portfolio.totalValue || 100000;
    const concentration = newValue / portfolioValue;
    
    if (concentration > this.config.maxConcentration) {
      return {
        allowed: false,
        reason: `Concentration in ${asset} ${(concentration * 100).toFixed(2)}% exceeds maximum ${(this.config.maxConcentration * 100).toFixed(2)}%`,
        asset,
        current: concentration,
        limit: this.config.maxConcentration
      };
    }
    
    return { allowed: true };
  }

  /**
   * Check trade cooldown
   * @param {string} userId - User ID
   */
  checkCooldown(userId) {
    const userData = this.userData.get(userId);
    
    if (userData?.lastTradeTime) {
      const elapsed = Date.now() - userData.lastTradeTime;
      
      if (elapsed < this.config.tradeCooldownMs) {
        const remaining = this.config.tradeCooldownMs - elapsed;
        return {
          allowed: false,
          reason: `Trade cooldown active. Wait ${Math.ceil(remaining / 1000)}s`,
          remaining
        };
      }
    }
    
    return { allowed: true };
  }

  /**
   * Check drawdown limits
   * @param {string} userId - User ID
   * @param {Object} portfolio - Portfolio state
   */
  checkDrawdown(userId, portfolio) {
    const currentEquity = portfolio.totalValue || 0;
    const peak = this.peakEquity.get(userId) || currentEquity;
    
    // Update peak
    if (currentEquity > peak) {
      this.peakEquity.set(userId, currentEquity);
      return { allowed: true };
    }
    
    const drawdown = peak - currentEquity;
    const drawdownPercent = (drawdown / peak) * 100;
    
    if (drawdownPercent >= this.config.maxDrawdownPercent) {
      return {
        allowed: false,
        reason: `Maximum drawdown exceeded: ${drawdownPercent.toFixed(2)}% / ${this.config.maxDrawdownPercent}%`,
        drawdown,
        drawdownPercent,
        peak,
        currentEquity
      };
    }
    
    return { allowed: true };
  }

  /**
   * Check consecutive losses
   * @param {string} userId - User ID
   */
  checkConsecutiveLosses(userId) {
    const losses = this.consecutiveLosses.get(userId) || 0;
    
    if (losses >= this.config.maxConsecutiveLosses) {
      return {
        allowed: false,
        reason: `Maximum consecutive losses reached: ${losses} / ${this.config.maxConsecutiveLosses}`,
        current: losses,
        limit: this.config.maxConsecutiveLosses
      };
    }
    
    return { allowed: true };
  }

  /**
   * Check slippage limits
   * @param {Object} tradeParams - Trade parameters
   */
  checkSlippage(tradeParams) {
    if (!tradeParams.expectedPrice || !tradeParams.executionPrice) {
      return { allowed: true };
    }
    
    const slippage = Math.abs(tradeParams.executionPrice - tradeParams.expectedPrice) / tradeParams.expectedPrice;
    
    if (slippage > this.config.maxSlippagePercent / 100) {
      return {
        allowed: false,
        reason: `Slippage ${(slippage * 100).toFixed(2)}% exceeds maximum ${this.config.maxSlippagePercent}%`,
        slippage,
        limit: this.config.maxSlippagePercent / 100
      };
    }
    
    return { allowed: true };
  }

  /**
   * Check price deviation
   * @param {Object} tradeParams - Trade parameters
   */
  checkPriceDeviation(tradeParams) {
    if (!tradeParams.price || !tradeParams.marketPrice) {
      return { allowed: true };
    }
    
    const deviation = Math.abs(tradeParams.price - tradeParams.marketPrice) / tradeParams.marketPrice;
    
    if (deviation > this.config.maxPriceDeviationPercent / 100) {
      return {
        allowed: false,
        reason: `Price deviation ${(deviation * 100).toFixed(2)}% exceeds maximum ${this.config.maxPriceDeviationPercent}%`,
        deviation,
        limit: this.config.maxPriceDeviationPercent / 100
      };
    }
    
    return { allowed: true };
  }

  /**
   * Handle trade completion
   * @param {Object} data - Trade data
   */
  handleTrade(data) {
    const { order, userId } = data;
    if (!userId) return;
    
    this.initializeUser(userId);
    const userData = this.userData.get(userId);
    
    // Update daily stats
    const tradeValue = (order.filledAmount || 0) * (order.averagePrice || 0);
    userData.dailyStats.tradeCount++;
    userData.dailyStats.volume += tradeValue;
    userData.dailyStats.fees += order.fee || 0;
    userData.lastTradeTime = Date.now();
    
    // Track realized PnL
    if (order.realizedPnL) {
      userData.dailyStats.realizedPnL += order.realizedPnL;
      userData.realizedPnL += order.realizedPnL;
      
      // Track consecutive losses
      if (order.realizedPnL < 0) {
        const currentLosses = this.consecutiveLosses.get(userId) || 0;
        this.consecutiveLosses.set(userId, currentLosses + 1);
      } else {
        this.consecutiveLosses.set(userId, 0);
      }
    }
    
    userData.dailyStats.trades.push({
      timestamp: Date.now(),
      side: order.side,
      amount: order.filledAmount,
      price: order.averagePrice,
      pnl: order.realizedPnL
    });
  }

  /**
   * Trigger circuit breaker
   * @param {string} userId - User ID
   * @param {Array} reasons - Trigger reasons
   */
  triggerCircuitBreaker(userId, reasons) {
    this.circuitBreakers.set(userId, {
      active: true,
      triggeredAt: Date.now(),
      reasons,
      duration: this.config.circuitBreakerDuration
    });
    
    logger.error(`CIRCUIT BREAKER TRIGGERED for user ${userId}`, reasons);

    this.emit('circuitBreakerTriggered', {
      userId,
      reasons,
      timestamp: Date.now(),
      duration: this.config.circuitBreakerDuration
    });
    
    eventBus.publish('risk:circuitBreakerTriggered', {
      userId,
      reasons,
      timestamp: Date.now(),
      duration: this.config.circuitBreakerDuration
    });
  }

  /**
   * Reset circuit breaker
   * @param {string} userId - User ID
   */
  resetCircuitBreaker(userId) {
    this.circuitBreakers.delete(userId);
    logger.info(`Circuit breaker manually reset for user ${userId}`);
    
    eventBus.publish('risk:circuitBreakerReset', {
      userId,
      manual: true,
      timestamp: Date.now()
    });
  }

  /**
   * Get risk status for user
   * @param {string} userId - User ID
   * @param {Object} portfolio - Portfolio state
   */
  getRiskStatus(userId, portfolio = {}) {
    this.initializeUser(userId, portfolio.totalValue);
    
    const userData = this.userData.get(userId);
    const breaker = this.circuitBreakers.get(userId);
    const peak = this.peakEquity.get(userId) || portfolio.totalValue || 0;
    const current = portfolio.totalValue || 0;
    const drawdown = peak > 0 ? ((peak - current) / peak) * 100 : 0;
    
    return {
      userId,
      circuitBreaker: breaker ? {
        active: true,
        triggeredAt: breaker.triggeredAt,
        remaining: Math.max(0, this.config.circuitBreakerDuration - (Date.now() - breaker.triggeredAt)),
        reasons: breaker.reasons
      } : null,
      dailyStats: userData.dailyStats,
      drawdown: {
        current: drawdown,
        peak,
        currentEquity: current
      },
      consecutiveLosses: this.consecutiveLosses.get(userId) || 0,
      limits: {
        maxPositionSize: this.config.maxPositionSize,
        maxTotalExposure: this.config.maxTotalExposure,
        maxDailyLoss: this.config.maxDailyLoss,
        maxDrawdownPercent: this.config.maxDrawdownPercent,
        maxConsecutiveLosses: this.config.maxConsecutiveLosses
      },
      usage: {
        dailyTrades: userData.dailyStats.tradeCount / this.config.maxDailyTrades,
        dailyVolume: userData.dailyStats.volume / this.config.maxDailyVolume,
        dailyLoss: Math.abs(Math.min(0, userData.dailyStats.realizedPnL)) / ((portfolio.totalValue || 100000) * this.config.maxDailyLoss)
      }
    };
  }

  /**
   * Get all circuit breakers
   */
  getActiveCircuitBreakers() {
    const active = [];
    for (const [userId, breaker] of this.circuitBreakers) {
      if (breaker.active) {
        active.push({
          userId,
          triggeredAt: breaker.triggeredAt,
          remaining: Math.max(0, this.config.circuitBreakerDuration - (Date.now() - breaker.triggeredAt))
        });
      }
    }
    return active;
  }
}

module.exports = EnhancedRiskManager;
