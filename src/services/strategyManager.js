const TradingStrategy = require('../models/tradingStrategy');
const logger = require('../utils/logger');
const redisClient = require('../utils/redis');

class StrategyManager {
  constructor() {
    this.strategies = new Map(); // strategyId -> TradingStrategy
    this.userStrategies = new Map(); // userId -> Set of strategyIds
    this.runningStrategies = new Set();
    this.executionInterval = null;
  }

  // Initialize strategy manager
  async initialize() {
    logger.info('Initializing strategy manager...');
    
    // Start strategy execution loop
    this.startExecutionLoop();
    
    logger.info('✅ Strategy manager initialized');
  }

  // Create new strategy
  async createStrategy(userId, strategyConfig) {
    try {
      logger.info(`Creating strategy for user ${userId}:`, strategyConfig);

      const strategy = new TradingStrategy({
        ...strategyConfig,
        userId
      });

      // Store strategy
      this.strategies.set(strategy.id, strategy);
      
      // Add to user's strategies
      if (!this.userStrategies.has(userId)) {
        this.userStrategies.set(userId, new Set());
      }
      this.userStrategies.get(userId).add(strategy.id);

      // Persist to Redis
      await this.persistStrategy(strategy);

      logger.info(`Strategy ${strategy.id} created successfully`);

      return {
        success: true,
        message: 'Strategy created successfully',
        data: strategy.getSummary()
      };

    } catch (error) {
      logger.error('Failed to create strategy:', error);
      return {
        success: false,
        error: 'Failed to create strategy',
        details: error.message
      };
    }
  }

  // Get strategy by ID
  async getStrategy(strategyId) {
    // Check memory cache
    if (this.strategies.has(strategyId)) {
      return this.strategies.get(strategyId);
    }

    // Try to load from Redis
    const strategyData = await redisClient.get(`strategy:${strategyId}`);
    if (strategyData) {
      const strategy = this.reconstructStrategy(strategyData);
      this.strategies.set(strategyId, strategy);
      return strategy;
    }

    return null;
  }

  // Get all strategies for a user
  async getUserStrategies(userId, filters = {}) {
    const strategyIds = this.userStrategies.get(userId) || new Set();
    const strategies = [];

    for (const strategyId of strategyIds) {
      const strategy = await this.getStrategy(strategyId);
      if (strategy) {
        // Apply filters
        if (filters.status && strategy.status !== filters.status) continue;
        if (filters.type && strategy.type !== filters.type) continue;
        if (filters.pair && strategy.pair !== filters.pair) continue;

        strategies.push(strategy.getSummary());
      }
    }

    return strategies;
  }

  // Activate strategy
  async activateStrategy(strategyId) {
    try {
      const strategy = await this.getStrategy(strategyId);
      
      if (!strategy) {
        return { success: false, error: 'Strategy not found' };
      }

      const result = strategy.activate();
      
      if (result.success) {
        await this.persistStrategy(strategy);
        this.runningStrategies.add(strategyId);
      }

      return result;

    } catch (error) {
      logger.error(`Failed to activate strategy ${strategyId}:`, error);
      return { success: false, error: error.message };
    }
  }

  // Deactivate strategy
  async deactivateStrategy(strategyId) {
    try {
      const strategy = await this.getStrategy(strategyId);
      
      if (!strategy) {
        return { success: false, error: 'Strategy not found' };
      }

      const result = strategy.deactivate();
      
      if (result.success) {
        await this.persistStrategy(strategy);
        this.runningStrategies.delete(strategyId);
      }

      return result;

    } catch (error) {
      logger.error(`Failed to deactivate strategy ${strategyId}:`, error);
      return { success: false, error: error.message };
    }
  }

  // Pause strategy
  async pauseStrategy(strategyId) {
    try {
      const strategy = await this.getStrategy(strategyId);
      
      if (!strategy) {
        return { success: false, error: 'Strategy not found' };
      }

      const result = strategy.pause();
      
      if (result.success) {
        await this.persistStrategy(strategy);
      }

      return result;

    } catch (error) {
      logger.error(`Failed to pause strategy ${strategyId}:`, error);
      return { success: false, error: error.message };
    }
  }

  // Resume strategy
  async resumeStrategy(strategyId) {
    try {
      const strategy = await this.getStrategy(strategyId);
      
      if (!strategy) {
        return { success: false, error: 'Strategy not found' };
      }

      const result = strategy.resume();
      
      if (result.success) {
        await this.persistStrategy(strategy);
      }

      return result;

    } catch (error) {
      logger.error(`Failed to resume strategy ${strategyId}:`, error);
      return { success: false, error: error.message };
    }
  }

  // Update strategy parameters
  async updateStrategy(strategyId, updates) {
    try {
      const strategy = await this.getStrategy(strategyId);
      
      if (!strategy) {
        return { success: false, error: 'Strategy not found' };
      }

      if (updates.parameters) {
        strategy.updateParameters(updates.parameters);
      }

      if (updates.name) {
        strategy.name = updates.name;
      }

      if (updates.description) {
        strategy.description = updates.description;
      }

      await this.persistStrategy(strategy);

      return {
        success: true,
        message: 'Strategy updated successfully',
        data: strategy.getSummary()
      };

    } catch (error) {
      logger.error(`Failed to update strategy ${strategyId}:`, error);
      return { success: false, error: error.message };
    }
  }

  // Delete strategy
  async deleteStrategy(strategyId) {
    try {
      const strategy = await this.getStrategy(strategyId);
      
      if (!strategy) {
        return { success: false, error: 'Strategy not found' };
      }

      // Remove from user's strategies
      const userId = strategy.userId;
      if (this.userStrategies.has(userId)) {
        this.userStrategies.get(userId).delete(strategyId);
      }

      // Remove from running strategies
      this.runningStrategies.delete(strategyId);

      // Remove from memory
      this.strategies.delete(strategyId);

      // Remove from Redis
      await redisClient.del(`strategy:${strategyId}`);

      logger.info(`Strategy ${strategyId} deleted`);

      return { success: true, message: 'Strategy deleted successfully' };

    } catch (error) {
      logger.error(`Failed to delete strategy ${strategyId}:`, error);
      return { success: false, error: error.message };
    }
  }

  // Execute all active strategies
  async executeStrategies(marketData) {
    for (const strategyId of this.runningStrategies) {
      try {
        const strategy = await this.getStrategy(strategyId);
        
        if (strategy && strategy.status === 'active') {
          const result = await strategy.execute(marketData);
          
          if (result.success && result.action !== 'hold') {
            // Emit signal for order execution
            this.emit('strategySignal', {
              strategyId: strategy.id,
              userId: strategy.userId,
              signal: result.signal
            });
          }
        }
      } catch (error) {
        logger.error(`Error executing strategy ${strategyId}:`, error);
      }
    }
  }

  // Start execution loop
  startExecutionLoop() {
    if (this.executionInterval) {
      return;
    }

    // Execute strategies every 30 seconds
    this.executionInterval = setInterval(async () => {
      try {
        // In production, fetch real market data
        const mockMarketData = this.generateMockMarketData();
        await this.executeStrategies(mockMarketData);
      } catch (error) {
        logger.error('Error in strategy execution loop:', error);
      }
    }, 30000);

    logger.info('Strategy execution loop started');
  }

  // Stop execution loop
  stopExecutionLoop() {
    if (this.executionInterval) {
      clearInterval(this.executionInterval);
      this.executionInterval = null;
      logger.info('Strategy execution loop stopped');
    }
  }

  // Generate mock market data for testing
  generateMockMarketData() {
    return {
      timestamp: Date.now(),
      pairs: {
        'BTC/USD': {
          price: 50000 + Math.random() * 1000,
          bid: 49950,
          ask: 50050,
          volume: 1000,
          change24h: 2.5
        },
        'ETH/USD': {
          price: 3000 + Math.random() * 100,
          bid: 2995,
          ask: 3005,
          volume: 5000,
          change24h: 1.8
        }
      }
    };
  }

  // Persist strategy to Redis
  async persistStrategy(strategy) {
    try {
      const key = `strategy:${strategy.id}`;
      await redisClient.set(key, strategy, 86400); // 24 hours TTL
    } catch (error) {
      logger.error(`Failed to persist strategy ${strategy.id}:`, error);
    }
  }

  // Reconstruct strategy from stored data
  reconstructStrategy(data) {
    const strategy = new TradingStrategy({
      id: data.id,
      userId: data.userId,
      name: data.name,
      description: data.description,
      type: data.type,
      pair: data.pair,
      exchange: data.exchange,
      side: data.side,
      parameters: data.parameters,
      maxPositionSize: data.maxPositionSize,
      maxDailyTrades: data.maxDailyTrades,
      stopLoss: data.stopLoss,
      takeProfit: data.takeProfit,
      orderType: data.orderType,
      timeInForce: data.timeInForce
    });

    // Restore state
    strategy.status = data.status;
    strategy.trades = data.trades || [];
    strategy.signals = data.signals || [];
    strategy.performance = data.performance || strategy.performance;
    strategy.createdAt = new Date(data.createdAt);
    strategy.updatedAt = new Date(data.updatedAt);
    strategy.lastRunAt = data.lastRunAt ? new Date(data.lastRunAt) : null;
    strategy.error = data.error;

    return strategy;
  }

  // Get strategy performance summary
  async getStrategyPerformance(strategyId) {
    const strategy = await this.getStrategy(strategyId);
    
    if (!strategy) {
      return null;
    }

    return strategy.getPerformanceReport();
  }

  // Get all active strategies count
  getActiveStrategiesCount() {
    return this.runningStrategies.size;
  }
}

module.exports = StrategyManager;