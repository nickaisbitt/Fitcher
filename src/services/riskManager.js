const logger = require('../utils/logger');
const EventEmitter = require('events');

class RiskManager extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      // Position limits
      maxPositionSize: config.maxPositionSize || 0.2, // 20% of portfolio per position
      maxTotalExposure: config.maxTotalExposure || 0.8, // 80% of portfolio max
      
      // Daily limits
      maxDailyLoss: config.maxDailyLoss || 0.05, // 5% max daily loss
      maxDailyTrades: config.maxDailyTrades || 100,
      maxDailyVolume: config.maxDailyVolume || 100000, // USD
      
      // Order limits
      maxOrderSize: config.maxOrderSize || 0.1, // 10% of portfolio per order
      maxOpenOrders: config.maxOpenOrders || 20,
      
      // Price protection
      maxSlippage: config.maxSlippage || 0.02, // 2% max slippage
      maxPriceDeviation: config.maxPriceDeviation || 0.05, // 5% from market price
      
      // Circuit breaker
      circuitBreakerThreshold: config.circuitBreakerThreshold || 0.1, // 10% portfolio loss
      circuitBreakerDuration: config.circuitBreakerDuration || 3600000, // 1 hour
      
      // Cooldown periods
      tradeCooldown: config.tradeCooldown || 1000, // 1 second between trades
      
      ...config
    };
    
    this.dailyStats = new Map(); // userId -> daily stats
    this.circuitBreakers = new Map(); // userId -> circuit breaker status
    this.lastTradeTime = new Map(); // userId -> last trade timestamp
  }

  // Check if trade is allowed
  async checkTrade(userId, tradeParams, portfolioValue, currentPositions = []) {
    const checks = {
      positionSize: await this.checkPositionSize(userId, tradeParams, portfolioValue, currentPositions),
      dailyLimits: await this.checkDailyLimits(userId, tradeParams),
      orderSize: await this.checkOrderSize(userId, tradeParams, portfolioValue),
      circuitBreaker: await this.checkCircuitBreaker(userId),
      cooldown: await this.checkCooldown(userId),
      priceDeviation: await this.checkPriceDeviation(tradeParams)
    };

    const failedChecks = Object.entries(checks)
      .filter(([_, result]) => !result.allowed)
      .map(([name, result]) => ({ check: name, reason: result.reason }));

    const allowed = failedChecks.length === 0;

    if (!allowed) {
      logger.warn(`Risk check failed for user ${userId}:`, failedChecks);
      this.emit('riskCheckFailed', { userId, tradeParams, failedChecks });
    }

    return {
      allowed,
      checks,
      failedChecks,
      timestamp: Date.now()
    };
  }

  // Check position size limits
  async checkPositionSize(userId, tradeParams, portfolioValue, currentPositions) {
    const { pair, side, amount, price } = tradeParams;
    const asset = pair.split('/')[0];
    const orderValue = amount * price;
    
    // Find current position for this asset
    const currentPosition = currentPositions.find(p => p.asset === asset);
    const currentPositionValue = currentPosition ? currentPosition.totalValue : 0;
    
    // Calculate new position value after trade
    let newPositionValue = currentPositionValue;
    if (side === 'buy') {
      newPositionValue += orderValue;
    } else {
      newPositionValue -= orderValue;
    }
    
    // Check if exceeds max position size
    const positionRatio = newPositionValue / portfolioValue;
    if (positionRatio > this.config.maxPositionSize) {
      return {
        allowed: false,
        reason: `Position size ${(positionRatio * 100).toFixed(2)}% exceeds maximum ${(this.config.maxPositionSize * 100).toFixed(2)}%`,
        currentPosition: currentPositionValue,
        newPosition: newPositionValue,
        maxAllowed: portfolioValue * this.config.maxPositionSize
      };
    }
    
    // Check total exposure
    const totalExposure = currentPositions.reduce((sum, p) => sum + p.totalValue, 0);
    const newTotalExposure = side === 'buy' 
      ? totalExposure + orderValue 
      : totalExposure - orderValue;
    
    const exposureRatio = newTotalExposure / portfolioValue;
    if (exposureRatio > this.config.maxTotalExposure) {
      return {
        allowed: false,
        reason: `Total exposure ${(exposureRatio * 100).toFixed(2)}% exceeds maximum ${(this.config.maxTotalExposure * 100).toFixed(2)}%`,
        currentExposure: totalExposure,
        newExposure: newTotalExposure,
        maxAllowed: portfolioValue * this.config.maxTotalExposure
      };
    }

    return { allowed: true };
  }

  // Check daily trading limits
  async checkDailyLimits(userId, tradeParams) {
    const stats = this.getDailyStats(userId);
    const { amount, price } = tradeParams;
    const tradeValue = amount * price;
    
    // Check daily loss
    if (stats.dailyPnL < -portfolioValue * this.config.maxDailyLoss) {
      return {
        allowed: false,
        reason: `Daily loss limit exceeded. Current P&L: $${stats.dailyPnL.toFixed(2)}`,
        limit: -portfolioValue * this.config.maxDailyLoss,
        current: stats.dailyPnL
      };
    }
    
    // Check daily trade count
    if (stats.tradeCount >= this.config.maxDailyTrades) {
      return {
        allowed: false,
        reason: `Daily trade limit reached. Count: ${stats.tradeCount}/${this.config.maxDailyTrades}`,
        limit: this.config.maxDailyTrades,
        current: stats.tradeCount
      };
    }
    
    // Check daily volume
    if (stats.volume + tradeValue > this.config.maxDailyVolume) {
      return {
        allowed: false,
        reason: `Daily volume limit would be exceeded. Current: $${stats.volume.toFixed(2)}, New: $${(stats.volume + tradeValue).toFixed(2)}`,
        limit: this.config.maxDailyVolume,
        current: stats.volume,
        projected: stats.volume + tradeValue
      };
    }

    return { allowed: true };
  }

  // Check order size limits
  async checkOrderSize(userId, tradeParams, portfolioValue) {
    const { amount, price } = tradeParams;
    const orderValue = amount * price;
    const orderRatio = orderValue / portfolioValue;
    
    if (orderRatio > this.config.maxOrderSize) {
      return {
        allowed: false,
        reason: `Order size ${(orderRatio * 100).toFixed(2)}% exceeds maximum ${(this.config.maxOrderSize * 100).toFixed(2)}%`,
        orderValue,
        maxAllowed: portfolioValue * this.config.maxOrderSize
      };
    }

    return { allowed: true };
  }

  // Check circuit breaker
  async checkCircuitBreaker(userId) {
    const breaker = this.circuitBreakers.get(userId);
    
    if (breaker && breaker.active) {
      const now = Date.now();
      const elapsed = now - breaker.triggeredAt;
      
      if (elapsed < this.config.circuitBreakerDuration) {
        const remaining = this.config.circuitBreakerDuration - elapsed;
        return {
          allowed: false,
          reason: `Circuit breaker active. Trading suspended for ${Math.ceil(remaining / 60000)} more minutes`,
          triggeredAt: breaker.triggeredAt,
          remaining: remaining
        };
      } else {
        // Circuit breaker expired
        this.circuitBreakers.delete(userId);
        logger.info(`Circuit breaker expired for user ${userId}`);
        this.emit('circuitBreakerReset', { userId });
      }
    }

    return { allowed: true };
  }

  // Check cooldown between trades
  async checkCooldown(userId) {
    const lastTrade = this.lastTradeTime.get(userId);
    
    if (lastTrade) {
      const elapsed = Date.now() - lastTrade;
      if (elapsed < this.config.tradeCooldown) {
        const remaining = this.config.tradeCooldown - elapsed;
        return {
          allowed: false,
          reason: `Trade cooldown active. Wait ${Math.ceil(remaining / 1000)} more seconds`,
          remaining: remaining
        };
      }
    }

    return { allowed: true };
  }

  // Check price deviation
  async checkPriceDeviation(tradeParams) {
    const { price, type, marketPrice } = tradeParams;
    
    // Only check for limit orders
    if (type !== 'limit' || !marketPrice) {
      return { allowed: true };
    }
    
    const deviation = Math.abs(price - marketPrice) / marketPrice;
    
    if (deviation > this.config.maxPriceDeviation) {
      return {
        allowed: false,
        reason: `Price deviation ${(deviation * 100).toFixed(2)}% exceeds maximum ${(this.config.maxPriceDeviation * 100).toFixed(2)}%`,
        orderPrice: price,
        marketPrice: marketPrice,
        deviation: deviation
      };
    }

    return { allowed: true };
  }

  // Update daily stats after trade
  updateDailyStats(userId, trade) {
    const stats = this.getDailyStats(userId);
    
    stats.tradeCount++;
    stats.volume += trade.amount * trade.price;
    stats.fees += trade.fee || 0;
    
    if (trade.realizedPnL) {
      stats.dailyPnL += trade.realizedPnL;
    }
    
    this.lastTradeTime.set(userId, Date.now());
    
    // Check if circuit breaker should trigger
    this.checkCircuitBreakerTrigger(userId, stats);
  }

  // Get or create daily stats
  getDailyStats(userId) {
    if (!this.dailyStats.has(userId)) {
      this.dailyStats.set(userId, {
        tradeCount: 0,
        volume: 0,
        fees: 0,
        dailyPnL: 0,
        date: new Date().toDateString()
      });
    }
    
    const stats = this.dailyStats.get(userId);
    
    // Reset if new day
    if (stats.date !== new Date().toDateString()) {
      const newStats = {
        tradeCount: 0,
        volume: 0,
        fees: 0,
        dailyPnL: 0,
        date: new Date().toDateString()
      };
      this.dailyStats.set(userId, newStats);
      return newStats;
    }
    
    return stats;
  }

  // Check and trigger circuit breaker
  checkCircuitBreakerTrigger(userId, stats) {
    // In production, this would check portfolio value
    // For now, use a mock portfolio value
    const mockPortfolioValue = 100000;
    
    if (stats.dailyPnL < -mockPortfolioValue * this.config.circuitBreakerThreshold) {
      this.triggerCircuitBreaker(userId, stats.dailyPnL, mockPortfolioValue);
    }
  }

  // Trigger circuit breaker
  triggerCircuitBreaker(userId, dailyPnL, portfolioValue) {
    const lossPercent = Math.abs(dailyPnL / portfolioValue * 100);
    
    this.circuitBreakers.set(userId, {
      active: true,
      triggeredAt: Date.now(),
      dailyPnL: dailyPnL,
      portfolioValue: portfolioValue,
      lossPercent: lossPercent
    });
    
    logger.error(`CIRCUIT BREAKER TRIGGERED for user ${userId}`, {
      dailyPnL,
      portfolioValue,
      lossPercent: lossPercent.toFixed(2) + '%',
      duration: this.config.circuitBreakerDuration
    });
    
    this.emit('circuitBreakerTriggered', {
      userId,
      dailyPnL,
      portfolioValue,
      lossPercent,
      duration: this.config.circuitBreakerDuration
    });
  }

  // Manual reset circuit breaker
  resetCircuitBreaker(userId) {
    if (this.circuitBreakers.has(userId)) {
      this.circuitBreakers.delete(userId);
      logger.info(`Circuit breaker manually reset for user ${userId}`);
      this.emit('circuitBreakerReset', { userId, manual: true });
      return true;
    }
    return false;
  }

  // Get risk status for user
  getRiskStatus(userId, portfolioValue) {
    const stats = this.getDailyStats(userId);
    const breaker = this.circuitBreakers.get(userId);
    
    return {
      userId,
      dailyStats: stats,
      circuitBreaker: breaker ? {
        active: breaker.active,
        triggeredAt: breaker.triggeredAt,
        remaining: breaker.active 
          ? Math.max(0, this.config.circuitBreakerDuration - (Date.now() - breaker.triggeredAt))
          : 0
      } : null,
      limits: {
        maxPositionSize: this.config.maxPositionSize,
        maxTotalExposure: this.config.maxTotalExposure,
        maxDailyLoss: this.config.maxDailyLoss,
        maxDailyTrades: this.config.maxDailyTrades,
        maxOrderSize: this.config.maxOrderSize
      },
      usage: {
        positionSize: 0, // Would be calculated from actual positions
        dailyTrades: stats.tradeCount / this.config.maxDailyTrades,
        dailyVolume: stats.volume / this.config.maxDailyVolume,
        dailyLoss: Math.abs(stats.dailyPnL) / (portfolioValue * this.config.maxDailyLoss)
      }
    };
  }
}

module.exports = RiskManager;