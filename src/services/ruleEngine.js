const TradingRule = require('../models/tradingRule');
const logger = require('../utils/logger');
const redisClient = require('../utils/redis');

class RuleEngine {
  constructor() {
    this.rules = new Map();
    this.userRules = new Map();
    this.evaluationInterval = null;
    this.isRunning = false;
  }

  // Initialize rule engine
  async initialize() {
    logger.info('Initializing rule engine...');
    
    // Start evaluation loop
    this.startEvaluationLoop();
    
    logger.info('✅ Rule engine initialized');
  }

  // Create new trading rule
  async createRule(userId, ruleConfig) {
    try {
      logger.info(`Creating trading rule for user ${userId}:`, ruleConfig);

      const rule = new TradingRule({
        ...ruleConfig,
        userId
      });

      // Store rule
      this.rules.set(rule.id, rule);

      // Add to user's rules
      if (!this.userRules.has(userId)) {
        this.userRules.set(userId, new Set());
      }
      this.userRules.get(userId).add(rule.id);

      // Persist to Redis
      await this.persistRule(rule);

      logger.info(`Trading rule ${rule.id} created successfully`);

      return {
        success: true,
        message: 'Trading rule created successfully',
        data: rule.getSummary()
      };

    } catch (error) {
      logger.error('Failed to create trading rule:', error);
      return {
        success: false,
        error: 'Failed to create trading rule',
        details: error.message
      };
    }
  }

  // Get rule by ID
  async getRule(ruleId) {
    // Check memory cache
    if (this.rules.has(ruleId)) {
      return this.rules.get(ruleId);
    }

    // Try to load from Redis
    const ruleData = await redisClient.get(`rule:${ruleId}`);
    if (ruleData) {
      const rule = this.reconstructRule(ruleData);
      this.rules.set(ruleId, rule);
      return rule;
    }

    return null;
  }

  // Get all rules for a user
  async getUserRules(userId, filters = {}) {
    const ruleIds = this.userRules.get(userId) || new Set();
    const rules = [];

    for (const ruleId of ruleIds) {
      const rule = await this.getRule(ruleId);
      if (rule) {
        // Apply filters
        if (filters.status && rule.status !== filters.status) continue;
        if (filters.exchange && rule.exchange !== filters.exchange) continue;
        if (filters.pair && rule.pair !== filters.pair) continue;

        rules.push(rule.getSummary());
      }
    }

    return rules;
  }

  // Update rule
  async updateRule(ruleId, updates) {
    try {
      const rule = await this.getRule(ruleId);

      if (!rule) {
        return { success: false, error: 'Rule not found' };
      }

      // Update allowed fields
      if (updates.name) rule.name = updates.name;
      if (updates.description) rule.description = updates.description;
      if (updates.conditions) rule.conditions = updates.conditions;
      if (updates.actions) rule.actions = updates.actions;
      if (updates.operator) rule.operator = updates.operator;
      if (updates.maxExecutions !== undefined) rule.maxExecutions = updates.maxExecutions;
      if (updates.cooldownPeriod !== undefined) rule.cooldownPeriod = updates.cooldownPeriod;
      if (updates.expiresAt) rule.expiresAt = updates.expiresAt;

      rule.updatedAt = new Date();

      await this.persistRule(rule);

      return {
        success: true,
        message: 'Rule updated successfully',
        data: rule.getSummary()
      };

    } catch (error) {
      logger.error(`Failed to update rule ${ruleId}:`, error);
      return { success: false, error: error.message };
    }
  }

  // Delete rule
  async deleteRule(ruleId) {
    try {
      const rule = await this.getRule(ruleId);

      if (!rule) {
        return { success: false, error: 'Rule not found' };
      }

      // Remove from user's rules
      const userId = rule.userId;
      if (this.userRules.has(userId)) {
        this.userRules.get(userId).delete(ruleId);
      }

      // Remove from memory
      this.rules.delete(ruleId);

      // Remove from Redis
      await redisClient.del(`rule:${ruleId}`);

      logger.info(`Trading rule ${ruleId} deleted`);

      return { success: true, message: 'Rule deleted successfully' };

    } catch (error) {
      logger.error(`Failed to delete rule ${ruleId}:`, error);
      return { success: false, error: error.message };
    }
  }

  // Pause rule
  async pauseRule(ruleId) {
    const rule = await this.getRule(ruleId);
    if (!rule) return { success: false, error: 'Rule not found' };

    const result = rule.pause();
    if (result.success) {
      await this.persistRule(rule);
    }
    return result;
  }

  // Resume rule
  async resumeRule(ruleId) {
    const rule = await this.getRule(ruleId);
    if (!rule) return { success: false, error: 'Rule not found' };

    const result = rule.resume();
    if (result.success) {
      await this.persistRule(rule);
    }
    return result;
  }

  // Reset rule
  async resetRule(ruleId) {
    const rule = await this.getRule(ruleId);
    if (!rule) return { success: false, error: 'Rule not found' };

    const result = rule.reset();
    if (result.success) {
      await this.persistRule(rule);
    }
    return result;
  }

  // Evaluate all active rules
  async evaluateRules(marketData, portfolioData, positionsData) {
    const triggeredRules = [];

    for (const [ruleId, rule] of this.rules) {
      if (rule.status !== 'active') continue;

      try {
        const userId = rule.userId;
        const portfolio = portfolioData[userId];
        const positions = positionsData[userId];

        const result = rule.trigger(marketData, portfolio, positions);

        if (result.triggered) {
          triggeredRules.push(result);
          
          // Persist updated rule state
          await this.persistRule(rule);

          // Emit event for action execution
          this.emit('ruleTriggered', result);
        }
      } catch (error) {
        logger.error(`Error evaluating rule ${ruleId}:`, error);
      }
    }

    return triggeredRules;
  }

  // Start evaluation loop
  startEvaluationLoop() {
    if (this.evaluationInterval) {
      return;
    }

    this.isRunning = true;

    // Evaluate rules every 10 seconds
    this.evaluationInterval = setInterval(async () => {
      if (!this.isRunning) return;

      try {
        // In production, fetch real market data
        const mockMarketData = this.generateMockMarketData();
        const mockPortfolioData = {};
        const mockPositionsData = {};

        await this.evaluateRules(mockMarketData, mockPortfolioData, mockPositionsData);
      } catch (error) {
        logger.error('Error in rule evaluation loop:', error);
      }
    }, 10000);

    logger.info('Rule evaluation loop started');
  }

  // Stop evaluation loop
  stopEvaluationLoop() {
    this.isRunning = false;
    if (this.evaluationInterval) {
      clearInterval(this.evaluationInterval);
      this.evaluationInterval = null;
      logger.info('Rule evaluation loop stopped');
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
          volume: 1000 + Math.random() * 500,
          avgVolume: 1200,
          change24h: 2.5
        },
        'ETH/USD': {
          price: 3000 + Math.random() * 100,
          bid: 2995,
          ask: 3005,
          volume: 5000 + Math.random() * 1000,
          avgVolume: 5500,
          change24h: 1.8
        }
      }
    };
  }

  // Persist rule to Redis
  async persistRule(rule) {
    try {
      const key = `rule:${rule.id}`;
      await redisClient.set(key, rule, 86400); // 24 hours TTL
    } catch (error) {
      logger.error(`Failed to persist rule ${rule.id}:`, error);
    }
  }

  // Reconstruct rule from stored data
  reconstructRule(data) {
    const rule = new TradingRule({
      id: data.id,
      userId: data.userId,
      name: data.name,
      description: data.description,
      exchange: data.exchange,
      pair: data.pair,
      conditions: data.conditions,
      operator: data.operator,
      actions: data.actions,
      maxExecutions: data.maxExecutions,
      cooldownPeriod: data.cooldownPeriod,
      expiresAt: data.expiresAt
    });

    // Restore state
    rule.status = data.status;
    rule.executionCount = data.executionCount || 0;
    rule.lastTriggeredAt = data.lastTriggeredAt;
    rule.triggerHistory = data.triggerHistory || [];
    rule.createdAt = new Date(data.createdAt);
    rule.updatedAt = new Date(data.updatedAt);

    return rule;
  }

  // Get rule engine status
  getStatus() {
    return {
      isRunning: this.isRunning,
      totalRules: this.rules.size,
      activeRules: Array.from(this.rules.values()).filter(r => r.status === 'active').length,
      totalUsers: this.userRules.size
    };
  }
}

module.exports = RuleEngine;