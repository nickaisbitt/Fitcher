const EventEmitter = require('events');
const logger = require('../utils/logger');
const eventBus = require('../utils/eventBus');

/**
 * TradingEngine - Central trading coordination system
 * Orchestrates strategies, rules, orders, and risk management
 */
class TradingEngine extends EventEmitter {
  constructor() {
    super();
    this.strategyManager = null;
    this.ruleEngine = null;
    this.orderManager = null;
    this.riskManager = null;
    this.positionManager = null;
    this.marketDataAggregator = null;
    this.isRunning = false;
    this.eventSubscriptions = [];
  }

  /**
   * Initialize the trading engine with all components
   * @param {Object} components - Trading system components
   */
  async initialize(components) {
    logger.info('Initializing trading engine...');
    
    this.strategyManager = components.strategyManager;
    this.ruleEngine = components.ruleEngine;
    this.orderManager = components.orderManager;
    this.riskManager = components.riskManager;
    this.positionManager = components.positionManager;
    this.marketDataAggregator = components.marketDataAggregator;
    
    // Set up event-driven architecture
    this.setupEventHandlers();
    
    // Initialize components with event bus
    if (this.strategyManager) {
      await this.strategyManager.initialize(this.marketDataAggregator);
    }
    
    if (this.ruleEngine) {
      await this.ruleEngine.initialize(this.marketDataAggregator);
    }
    
    this.isRunning = true;
    
    logger.info('✅ Trading engine initialized');
    
    // Emit initialization event
    eventBus.publish('trading:initialized', {
      timestamp: Date.now(),
      components: Object.keys(components).filter(k => components[k] !== null)
    });
  }

  /**
   * Set up event handlers for the trading system
   */
  setupEventHandlers() {
    // Strategy signals
    if (this.strategyManager) {
      this.strategyManager.on('strategySignal', async (signal) => {
        await this.handleStrategySignal(signal);
      });
    }
    
    // Rule triggers
    if (this.ruleEngine) {
      this.ruleEngine.on('ruleTriggered', async (trigger) => {
        await this.handleRuleTrigger(trigger);
      });
    }
    
    // Order events
    if (this.orderManager) {
      this.orderManager.on('orderFilled', async (order) => {
        await this.handleOrderFilled(order);
      });
      
      this.orderManager.on('orderCancelled', async (order) => {
        await this.handleOrderCancelled(order);
      });
    }
    
    // Risk events
    if (this.riskManager) {
      this.riskManager.on('circuitBreakerTriggered', (data) => {
        this.handleCircuitBreaker(data);
      });
      
      this.riskManager.on('riskCheckFailed', (data) => {
        logger.warn('Risk check failed:', data);
      });
    }
    
    // Subscribe to event bus for cross-component communication
    this.eventSubscriptions.push({
      event: 'market:priceUpdate',
      id: eventBus.subscribe('market:priceUpdate', (data) => {
        this.handlePriceUpdate(data);
      })
    });
    
    logger.info('Event handlers configured');
  }

  /**
   * Handle strategy signal
   * @param {Object} signal - Strategy signal
   */
  async handleStrategySignal(signal) {
    try {
      eventBus.publish('trading:strategySignal', signal);

      logger.info(`Processing strategy signal: ${signal.signal?.action}`, {
        strategyId: signal.strategyId,
        userId: signal.userId,
        pair: signal.signal?.pair
      });
      
      // Check risk limits
      if (this.riskManager) {
        const portfolioSummary = await this.positionManager?.getPortfolioSummary(signal.userId) || {};
        const positions = portfolioSummary.positions || [];
        const totalExposure = positions.reduce((sum, p) => sum + (p.totalValue || 0), 0);

        const riskCheck = await this.riskManager.checkTrade(
          signal.userId,
          {
            pair: signal.signal.pair,
            side: signal.signal.action,
            amount: signal.signal.amount,
            price: signal.signal.price,
            marketPrice: signal.signal.price
          },
          {
            totalValue: portfolioSummary.totalValue || 100000,
            positions,
            totalExposure
          }
        );
        
        if (!riskCheck.allowed) {
          logger.warn(`Strategy signal blocked by risk manager:`, riskCheck.failedChecks);
          eventBus.publish('trading:signalBlocked', {
            signal,
            reason: riskCheck.failedChecks
          });
          return;
        }
      }
      
      // Create order
      if (this.orderManager) {
        const orderResult = await this.orderManager.createOrder({
          userId: signal.userId,
          exchange: signal.signal.exchange || 'kraken',
          pair: signal.signal.pair,
          type: signal.signal.orderType || 'market',
          side: signal.signal.action,
          amount: signal.signal.amount,
          price: signal.signal.price,
          strategyId: signal.strategyId
        });
        
        if (orderResult.success) {
          eventBus.publish('trading:orderCreated', {
            signal,
            order: orderResult.data
          });
        } else {
          logger.error('Failed to create order from strategy signal:', orderResult.error);
        }
      }
    } catch (error) {
      logger.error('Error handling strategy signal:', error);
    }
  }

  /**
   * Handle rule trigger
   * @param {Object} trigger - Rule trigger
   */
  async handleRuleTrigger(trigger) {
    try {
      logger.info(`Processing rule trigger: ${trigger.ruleName}`, {
        ruleId: trigger.ruleId,
        actions: trigger.actionResults?.length
      });
      
      // Execute actions
      for (const action of trigger.actionResults || []) {
        switch (action.type) {
          case 'place_order':
            if (this.orderManager) {
              await this.orderManager.createOrder(action.params);
            }
            break;
            
          case 'send_notification':
            eventBus.publish('notification:send', action.notification);
            break;
            
          case 'update_strategy':
            if (this.strategyManager) {
              await this.strategyManager.updateStrategy(
                action.strategyId,
                action.updates
              );
            }
            break;
            
          case 'webhook':
            // TODO: Implement webhook call
            logger.info('Webhook action:', action.url);
            break;
            
          default:
            logger.warn(`Unknown action type: ${action.type}`);
        }
      }
      
      eventBus.publish('trading:ruleExecuted', trigger);
    } catch (error) {
      logger.error('Error handling rule trigger:', error);
    }
  }

  /**
   * Handle order filled
   * @param {Object} order - Filled order
   */
  async handleOrderFilled(order) {
    try {
      eventBus.publish('trading:orderFilled', { order, userId: order.userId });

      // Update position
      if (this.positionManager) {
        await this.positionManager.updatePositionFromTrade(
          order.userId,
          order.exchange,
          {
            pair: order.pair,
            side: order.side,
            amount: order.filledAmount,
            price: order.averagePrice,
            fee: order.fee
          }
        );
      }
      
      // Update strategy performance
      if (order.strategyId && this.strategyManager) {
        const strategy = await this.strategyManager.getStrategy(order.strategyId);
        if (strategy) {
          strategy.recordTrade({
            side: order.side,
            amount: order.filledAmount,
            price: order.averagePrice,
            fee: order.fee,
            realizedPnL: order.realizedPnL,
            timestamp: new Date()
          });
          await this.strategyManager.persistStrategy(strategy);
        }
      }
      
      eventBus.publish('trading:orderCompleted', {
        order,
        position: await this.positionManager?.getPortfolioSummary(order.userId)
      });
    } catch (error) {
      logger.error('Error handling order filled:', error);
    }
  }

  /**
   * Handle order cancelled
   * @param {Object} order - Cancelled order
   */
  async handleOrderCancelled(order) {
    eventBus.publish('trading:orderCancelled', { order });
  }

  /**
   * Handle circuit breaker
   * @param {Object} data - Circuit breaker data
   */
  async handleCircuitBreaker(data) {
    logger.error(`CIRCUIT BREAKER TRIGGERED for user ${data.userId}`, data);
    
    // Deactivate all strategies for user
    if (this.strategyManager) {
      const strategies = await this.strategyManager.getUserStrategies(data.userId);
      for (const strategy of strategies) {
        if (strategy.status === 'active') {
          await this.strategyManager.deactivateStrategy(strategy.id);
        }
      }
    }
    
    // Cancel all open orders for user
    if (this.orderManager) {
      const orders = await this.orderManager.getUserOrders(data.userId);
      for (const order of orders) {
        if (order.isActive?.() || ['pending', 'open', 'partial'].includes(order.status)) {
          await this.orderManager.cancelOrder(order.id);
        }
      }
    }
    
    eventBus.publish('trading:circuitBreaker', data);
  }

  /**
   * Handle price update
   * @param {Object} data - Price update data
   */
  async handlePriceUpdate(data) {
    // Update unrealized PnL for all positions
    if (this.positionManager) {
      // This would be optimized in production
      // For now, just emit event
      eventBus.publish('position:priceUpdate', data);
    }
  }

  /**
   * Get portfolio value for a user
   * @param {string} userId - User ID
   */
  async getPortfolioValue(userId) {
    if (!this.positionManager) return 100000; // Default mock value
    
    try {
      const summary = await this.positionManager.getPortfolioSummary(userId);
      return summary?.totalValue || 100000;
    } catch (error) {
      logger.error(`Failed to get portfolio value for ${userId}:`, error);
      return 100000;
    }
  }

  /**
   * Get trading engine status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      components: {
        strategyManager: !!this.strategyManager,
        ruleEngine: !!this.ruleEngine,
        orderManager: !!this.orderManager,
        riskManager: !!this.riskManager,
        positionManager: !!this.positionManager,
        marketDataAggregator: !!this.marketDataAggregator
      },
      eventBus: eventBus.getMetrics()
    };
  }

  /**
   * Shutdown the trading engine
   */
  async shutdown() {
    logger.info('Shutting down trading engine...');
    
    this.isRunning = false;
    
    // Unsubscribe from events
    this.eventSubscriptions.forEach((sub) => {
      eventBus.unsubscribe(sub.event, sub.id);
    });
    this.eventSubscriptions = [];
    
    // Shutdown components
    if (this.strategyManager) {
      await this.strategyManager.shutdown();
    }
    
    if (this.ruleEngine) {
      await this.ruleEngine.shutdown();
    }
    
    logger.info('✅ Trading engine shut down');
  }
}

module.exports = TradingEngine;
