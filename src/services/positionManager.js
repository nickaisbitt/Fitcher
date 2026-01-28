const Position = require('../models/position');
const logger = require('../utils/logger');
const redisClient = require('../utils/redis');

class PositionManager {
  constructor() {
    this.positions = new Map(); // userId:exchange:asset -> Position
  }

  // Get position key
  getPositionKey(userId, exchange, asset) {
    return `${userId}:${exchange}:${asset.toUpperCase()}`;
  }

  // Get or create position
  async getPosition(userId, exchange, asset, pair = null) {
    const key = this.getPositionKey(userId, exchange, asset);
    
    if (this.positions.has(key)) {
      return this.positions.get(key);
    }

    // Try to load from Redis
    const positionData = await redisClient.get(`position:${key}`);
    if (positionData) {
      const position = this.reconstructPosition(positionData);
      this.positions.set(key, position);
      return position;
    }

    // Create new position
    const position = new Position({
      userId,
      exchange,
      asset: asset.toUpperCase(),
      pair: pair || `${asset.toUpperCase()}/USD`
    });

    this.positions.set(key, position);
    return position;
  }

  // Update position from trade
  async updatePositionFromTrade(userId, exchange, trade) {
    try {
      const { pair, side, amount, price, fee } = trade;
      const asset = pair.split('/')[0];
      
      const position = await this.getPosition(userId, exchange, asset, pair);
      
      if (side.toLowerCase() === 'buy') {
        position.addBuyTrade({ amount, price, fee });
      } else if (side.toLowerCase() === 'sell') {
        position.addSellTrade({ amount, price, fee });
      }
      
      // Persist to Redis
      await this.persistPosition(position);
      
      logger.info(`Position updated for ${userId}: ${asset} ${side} ${amount}`, {
        userId,
        exchange,
        asset,
        side,
        amount,
        price
      });
      
      return position;
    } catch (error) {
      logger.error(`Failed to update position from trade:`, error);
      throw error;
    }
  }

  // Get all positions for a user
  async getUserPositions(userId, exchange = null) {
    const positions = [];
    
    for (const [key, position] of this.positions) {
      if (position.userId === userId) {
        if (!exchange || position.exchange === exchange) {
          positions.push(position);
        }
      }
    }
    
    return positions;
  }

  // Get portfolio summary
  async getPortfolioSummary(userId, currentPrices = {}) {
    try {
      const positions = await this.getUserPositions(userId);
      
      let totalValue = 0;
      let totalCost = 0;
      let totalRealizedPnL = 0;
      let totalUnrealizedPnL = 0;
      let totalFees = 0;
      
      const positionSummaries = [];
      
      for (const position of positions) {
        const currentPrice = currentPrices[position.asset] || position.averageEntryPrice;
        const summary = position.getSummary(currentPrice);
        
        totalValue += summary.totalValue || 0;
        totalCost += summary.totalCost || 0;
        totalRealizedPnL += summary.realizedPnL;
        totalUnrealizedPnL += summary.unrealizedPnL;
        totalFees += summary.totalFees;
        
        if (summary.totalAmount > 0) {
          positionSummaries.push(summary);
        }
      }
      
      const totalPnL = totalRealizedPnL + totalUnrealizedPnL;
      const pnlPercent = totalCost > 0 ? (totalPnL / totalCost) * 100 : 0;
      
      return {
        userId,
        totalValue,
        totalCost,
        totalRealizedPnL,
        totalUnrealizedPnL,
        totalPnL,
        pnlPercent,
        totalFees,
        positionCount: positionSummaries.length,
        positions: positionSummaries.sort((a, b) => b.totalValue - a.totalValue)
      };
    } catch (error) {
      logger.error(`Failed to get portfolio summary for ${userId}:`, error);
      throw error;
    }
  }

  // Get allocation breakdown
  async getAllocation(userId, currentPrices = {}) {
    try {
      const portfolio = await this.getPortfolioSummary(userId, currentPrices);
      
      if (portfolio.totalValue === 0) {
        return { assets: [], totalValue: 0 };
      }
      
      const allocations = portfolio.positions.map(pos => ({
        asset: pos.asset,
        amount: pos.totalAmount,
        value: pos.totalValue,
        allocation: (pos.totalValue / portfolio.totalValue) * 100,
        averageEntry: pos.averageEntryPrice,
        currentPrice: pos.currentPrice,
        unrealizedPnL: pos.unrealizedPnL,
        unrealizedPnLPercent: pos.pnlPercent
      }));
      
      return {
        totalValue: portfolio.totalValue,
        assets: allocations
      };
    } catch (error) {
      logger.error(`Failed to get allocation for ${userId}:`, error);
      throw error;
    }
  }

  // Calculate P&L report
  async getPnLReport(userId, period = 'all') {
    try {
      const positions = await this.getUserPositions(userId);
      
      let totalRealized = 0;
      let totalUnrealized = 0;
      let totalFees = 0;
      const assetPnL = {};
      
      const now = new Date();
      let cutoffDate = null;
      
      // Set cutoff date based on period
      switch (period) {
        case '24h':
          cutoffDate = new Date(now - 24 * 60 * 60 * 1000);
          break;
        case '7d':
          cutoffDate = new Date(now - 7 * 24 * 60 * 60 * 1000);
          break;
        case '30d':
          cutoffDate = new Date(now - 30 * 24 * 60 * 60 * 1000);
          break;
        case 'all':
        default:
          cutoffDate = null;
      }
      
      for (const position of positions) {
        // Filter trades by period
        const relevantTrades = cutoffDate 
          ? position.trades.filter(t => new Date(t.timestamp) >= cutoffDate)
          : position.trades;
        
        const realizedFromTrades = relevantTrades
          .filter(t => t.type === 'sell')
          .reduce((sum, t) => sum + (t.realizedPnL || 0), 0);
        
        const feesFromTrades = relevantTrades
          .reduce((sum, t) => sum + (t.fee || 0), 0);
        
        totalRealized += realizedFromTrades;
        totalFees += feesFromTrades;
        
        // Track per-asset P&L
        if (!assetPnL[position.asset]) {
          assetPnL[position.asset] = {
            asset: position.asset,
            realized: 0,
            fees: 0,
            trades: 0
          };
        }
        
        assetPnL[position.asset].realized += realizedFromTrades;
        assetPnL[position.asset].fees += feesFromTrades;
        assetPnL[position.asset].trades += relevantTrades.length;
      }
      
      return {
        userId,
        period,
        totalRealizedPnL: totalRealized,
        totalFees,
        netPnL: totalRealized - totalFees,
        assetBreakdown: Object.values(assetPnL),
        generatedAt: new Date()
      };
    } catch (error) {
      logger.error(`Failed to get P&L report for ${userId}:`, error);
      throw error;
    }
  }

  // Persist position to Redis
  async persistPosition(position) {
    try {
      const key = `position:${this.getPositionKey(position.userId, position.exchange, position.asset)}`;
      await redisClient.set(key, position, 86400); // 24 hours TTL
    } catch (error) {
      logger.error(`Failed to persist position:`, error);
    }
  }

  // Reconstruct position from stored data
  reconstructPosition(data) {
    const position = new Position({
      userId: data.userId,
      exchange: data.exchange,
      asset: data.asset,
      pair: data.pair
    });
    
    // Restore state
    position.totalAmount = data.totalAmount || 0;
    position.availableAmount = data.availableAmount || 0;
    position.lockedAmount = data.lockedAmount || 0;
    position.averageEntryPrice = data.averageEntryPrice || 0;
    position.totalCost = data.totalCost || 0;
    position.totalValue = data.totalValue || 0;
    position.realizedPnL = data.realizedPnL || 0;
    position.unrealizedPnL = data.unrealizedPnL || 0;
    position.totalPnL = data.totalPnL || 0;
    position.totalFees = data.totalFees || 0;
    position.trades = data.trades || [];
    position.openOrders = data.openOrders || [];
    position.createdAt = new Date(data.createdAt);
    position.updatedAt = new Date(data.updatedAt);
    position.lastTradeAt = data.lastTradeAt ? new Date(data.lastTradeAt) : null;
    
    return position;
  }

  // Get position metrics for all assets
  async getAllPositionMetrics(userId, currentPrices) {
    try {
      const positions = await this.getUserPositions(userId);
      const metrics = [];
      
      for (const position of positions) {
        const currentPrice = currentPrices[position.asset];
        if (currentPrice && position.totalAmount > 0) {
          const metric = position.getMetrics(currentPrice);
          if (metric) {
            metrics.push(metric);
          }
        }
      }
      
      // Calculate allocation percentages
      const totalValue = metrics.reduce((sum, m) => sum + m.currentValue, 0);
      metrics.forEach(m => {
        m.allocation = totalValue > 0 ? (m.currentValue / totalValue) * 100 : 0;
      });
      
      return metrics.sort((a, b) => b.currentValue - a.currentValue);
    } catch (error) {
      logger.error(`Failed to get position metrics for ${userId}:`, error);
      throw error;
    }
  }
}

module.exports = PositionManager;