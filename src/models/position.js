const logger = require('../utils/logger');

class Position {
  constructor(params) {
    this.userId = params.userId;
    this.exchange = params.exchange;
    this.asset = params.asset; // e.g., 'BTC', 'ETH'
    this.pair = params.pair; // e.g., 'BTC/USD'
    
    // Position quantities
    this.totalAmount = 0;
    this.availableAmount = 0;
    this.lockedAmount = 0; // Amount in open orders
    
    // Cost basis tracking
    this.averageEntryPrice = 0;
    this.totalCost = 0;
    this.totalValue = 0;
    
    // P&L tracking
    this.realizedPnL = 0;
    this.unrealizedPnL = 0;
    this.totalPnL = 0;
    this.totalFees = 0;
    
    // Trade history
    this.trades = [];
    this.openOrders = [];
    
    // Timestamps
    this.createdAt = new Date();
    this.updatedAt = new Date();
    this.lastTradeAt = null;
  }

  // Add a buy trade
  addBuyTrade(trade) {
    const { amount, price, fee } = trade;
    const cost = amount * price + fee;
    
    // Update average entry price using weighted average
    const newTotalCost = this.totalCost + cost;
    const newTotalAmount = this.totalAmount + amount;
    
    this.averageEntryPrice = newTotalAmount > 0 ? newTotalCost / newTotalAmount : 0;
    this.totalAmount = newTotalAmount;
    this.availableAmount += amount;
    this.totalCost = newTotalCost;
    this.totalFees += fee;
    
    // Record trade
    this.trades.push({
      ...trade,
      type: 'buy',
      timestamp: trade.timestamp || new Date()
    });
    
    this.lastTradeAt = new Date();
    this.updatedAt = new Date();
    
    logger.info(`Position buy: ${this.asset} +${amount} @ $${price}`, {
      userId: this.userId,
      asset: this.asset,
      amount,
      price,
      fee,
      newAvgPrice: this.averageEntryPrice
    });
  }

  // Add a sell trade
  addSellTrade(trade) {
    const { amount, price, fee } = trade;
    const proceeds = amount * price - fee;
    
    // Calculate realized P&L
    const costBasis = amount * this.averageEntryPrice;
    const realizedPnL = proceeds - costBasis;
    
    // Update position
    this.totalAmount -= amount;
    this.availableAmount -= amount;
    this.totalCost = Math.max(0, this.totalCost - costBasis);
    this.realizedPnL += realizedPnL;
    this.totalFees += fee;
    
    // Record trade
    this.trades.push({
      ...trade,
      type: 'sell',
      realizedPnL,
      timestamp: trade.timestamp || new Date()
    });
    
    this.lastTradeAt = new Date();
    this.updatedAt = new Date();
    
    logger.info(`Position sell: ${this.asset} -${amount} @ $${price}, P&L: $${realizedPnL.toFixed(2)}`, {
      userId: this.userId,
      asset: this.asset,
      amount,
      price,
      fee,
      realizedPnL
    });
    
    return realizedPnL;
  }

  // Lock amount for open order
  lockAmount(amount) {
    if (amount > this.availableAmount) {
      throw new Error(`Insufficient available balance. Available: ${this.availableAmount}, Requested: ${amount}`);
    }
    
    this.availableAmount -= amount;
    this.lockedAmount += amount;
    this.updatedAt = new Date();
    
    logger.debug(`Locked ${amount} ${this.asset} for order`, {
      userId: this.userId,
      asset: this.asset,
      amount,
      available: this.availableAmount,
      locked: this.lockedAmount
    });
  }

  // Unlock amount when order is cancelled/filled
  unlockAmount(amount) {
    if (amount > this.lockedAmount) {
      throw new Error(`Cannot unlock more than locked amount. Locked: ${this.lockedAmount}, Requested: ${amount}`);
    }
    
    this.lockedAmount -= amount;
    this.availableAmount += amount;
    this.updatedAt = new Date();
    
    logger.debug(`Unlocked ${amount} ${this.asset}`, {
      userId: this.userId,
      asset: this.asset,
      amount,
      available: this.availableAmount,
      locked: this.lockedAmount
    });
  }

  // Update unrealized P&L based on current market price
  updateUnrealizedPnL(currentPrice) {
    if (this.totalAmount <= 0) {
      this.unrealizedPnL = 0;
      return;
    }
    
    const currentValue = this.totalAmount * currentPrice;
    this.unrealizedPnL = currentValue - this.totalCost;
    this.totalValue = currentValue;
    this.totalPnL = this.realizedPnL + this.unrealizedPnL;
    
    this.updatedAt = new Date();
  }

  // Get position summary
  getSummary(currentPrice = null) {
    if (currentPrice) {
      this.updateUnrealizedPnL(currentPrice);
    }
    
    const pnlPercent = this.totalCost > 0 
      ? (this.totalPnL / this.totalCost) * 100 
      : 0;
    
    return {
      userId: this.userId,
      exchange: this.exchange,
      asset: this.asset,
      pair: this.pair,
      totalAmount: this.totalAmount,
      availableAmount: this.availableAmount,
      lockedAmount: this.lockedAmount,
      averageEntryPrice: this.averageEntryPrice,
      totalCost: this.totalCost,
      totalValue: this.totalValue,
      currentPrice: currentPrice,
      unrealizedPnL: this.unrealizedPnL,
      realizedPnL: this.realizedPnL,
      totalPnL: this.totalPnL,
      pnlPercent: pnlPercent,
      totalFees: this.totalFees,
      tradeCount: this.trades.length,
      openOrderCount: this.openOrders.length,
      lastTradeAt: this.lastTradeAt,
      updatedAt: this.updatedAt
    };
  }

  // Check if position is flat (no holdings)
  isFlat() {
    return this.totalAmount === 0;
  }

  // Check if position is long
  isLong() {
    return this.totalAmount > 0;
  }

  // Get position value at given price
  getValueAtPrice(price) {
    return this.totalAmount * price;
  }

  // Calculate position metrics
  getMetrics(currentPrice) {
    if (!currentPrice || this.totalAmount <= 0) {
      return null;
    }
    
    const currentValue = this.totalAmount * currentPrice;
    const costBasis = this.totalCost;
    const unrealizedPnL = currentValue - costBasis;
    const pnlPercent = costBasis > 0 ? (unrealizedPnL / costBasis) * 100 : 0;
    
    return {
      asset: this.asset,
      amount: this.totalAmount,
      averageEntry: this.averageEntryPrice,
      currentPrice: currentPrice,
      costBasis: costBasis,
      currentValue: currentValue,
      unrealizedPnL: unrealizedPnL,
      unrealizedPnLPercent: pnlPercent,
      allocation: 0 // Will be calculated by PositionManager
    };
  }
}

module.exports = Position;