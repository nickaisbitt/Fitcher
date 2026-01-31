const MeanReversionStrategy = require('./meanReversionStrategy');
const MomentumStrategy = require('./momentumStrategy');
const GridTradingStrategy = require('./gridTradingStrategy');
const logger = require('../utils/logger');

/**
 * StrategyFactory - Factory for creating strategy instances
 * Centralizes strategy creation and configuration
 */
class StrategyFactory {
  constructor() {
    this.strategies = new Map([
      ['mean_reversion', MeanReversionStrategy],
      ['momentum', MomentumStrategy],
      ['grid', GridTradingStrategy]
    ]);
  }

  /**
   * Create a strategy instance
   * @param {string} type - Strategy type
   * @param {Object} config - Strategy configuration
   */
  create(type, config = {}) {
    const StrategyClass = this.strategies.get(type.toLowerCase());
    
    if (!StrategyClass) {
      throw new Error(`Unknown strategy type: ${type}. Available: ${Array.from(this.strategies.keys()).join(', ')}`);
    }
    
    try {
      const strategy = new StrategyClass(config);
      logger.info(`Created ${type} strategy:`, strategy.getConfig());
      return strategy;
    } catch (error) {
      logger.error(`Failed to create ${type} strategy:`, error);
      throw error;
    }
  }

  /**
   * Get available strategy types
   */
  getAvailableTypes() {
    return Array.from(this.strategies.keys());
  }

  /**
   * Get strategy metadata
   * @param {string} type - Strategy type
   */
  getStrategyInfo(type) {
    const StrategyClass = this.strategies.get(type.toLowerCase());
    
    if (!StrategyClass) {
      return null;
    }
    
    // Create temporary instance to get config
    const temp = new StrategyClass({});
    
    return {
      type,
      name: temp.name,
      defaultConfig: temp.getConfig()
    };
  }

  /**
   * Get all strategy metadata
   */
  getAllStrategyInfo() {
    return this.getAvailableTypes().map(type => this.getStrategyInfo(type));
  }

  /**
   * Register a new strategy type
   * @param {string} type - Strategy type name
   * @param {Class} StrategyClass - Strategy class
   */
  register(type, StrategyClass) {
    this.strategies.set(type.toLowerCase(), StrategyClass);
    logger.info(`Registered new strategy type: ${type}`);
  }
}

// Create singleton instance
const strategyFactory = new StrategyFactory();

module.exports = strategyFactory;
