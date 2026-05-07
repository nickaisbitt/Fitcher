const EventEmitter = require('events');
const logger = require('../utils/logger');
const eventBus = require('../utils/eventBus');
const SignalAggregator = require('./SignalAggregator');
const SmartOrderRouter = require('./SmartOrderRouter');
const DynamicRiskManager = require('./DynamicRiskManager');
const MarketRegimeDetector = require('./MarketRegimeDetector');

/**
 * TradingEngine - Central trading coordination system
 * Orchestrates strategies, rules, orders, and risk management
 */
class TradingEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    this.strategyManager = null;
    this.ruleEngine = null;
    this.orderManager = null;
    this.riskManager = null;
    this.positionManager = null;
    this.marketDataAggregator = null;
    
    // V2 Components
    this.signalAggregator = new SignalAggregator(options.aggregatorConfig || {});
    this.orderRouter = new SmartOrderRouter(options.routerConfig || {});
    this.regimeDetector = new MarketRegimeDetector(options.regimeConfig || {});
    
    this.isRunning = false;
    this.eventSubscriptions = [];
    this.pendingSignals = []; // Buffer signals for aggregation window
    this.syncSignals = options.syncSignals || false; // For testing
  }

  /**
   * Initialize the trading engine with all components
   */
  async initialize(components) {
    logger.info('Initializing trading engine brain v2...');
    
    this.strategyManager = components.strategyManager;
    this.ruleEngine = components.ruleEngine;
    this.orderManager = components.orderManager;
    this.positionManager = components.positionManager;
    this.marketDataAggregator = components.marketDataAggregator;
    
    // Initialize Risk Manager
    // Use DynamicRiskManager if provided, otherwise create one
    this.riskManager = components.riskManager || new DynamicRiskManager({
      initialBalance: 100000,
      profile: 'conservative'
    });
    
    // Register strategies with aggregator
    if (this.strategyManager && this.strategyManager.strategies && typeof this.strategyManager.strategies.values === 'function') {
      try {
        const strategies = Array.from(this.strategyManager.strategies.values());
        for (const strategy of strategies) {
          if (strategy && strategy.name) {
            this.signalAggregator.registerStrategy(strategy.name);
          }
        }
      } catch (err) {
        logger.warn('Failed to register strategies with aggregator:', err.message);
      }
    }
    
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
    
    logger.info('✅ Trading engine brain v2 initialized');
    
    eventBus.publish('trading:initialized', {
      timestamp: Date.now(),
      v2: true
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
      // Publish raw signal for logging/audit
      eventBus.publish('trading:strategySignal', signal);

      // Buffer signals for aggregation
      this.pendingSignals.push(signal);
      
      if (this.syncSignals) {
        await this.processSignalBatch();
      } else if (this.pendingSignals.length === 1) {
        // If first signal in batch, set timer to aggregate
        setTimeout(() => this.processSignalBatch(), 500);
      }
    } catch (error) {
      logger.error('Error buffering strategy signal:', error);
    }
  }

  /**
   * Process a batch of buffered signals
   */
  async processSignalBatch() {
    if (this.pendingSignals.length === 0) return;
    
    const signals = [...this.pendingSignals];
    this.pendingSignals = [];
    
    try {
      const firstSignal = signals[0];
      const userId = firstSignal.userId;
      const pair = firstSignal.signal?.pair;
      
      // 1. Aggregate signals (Consensus)
      const rawSignals = signals.map(s => ({
        ...s.signal,
        strategy: s.strategyName || s.strategyId
      }));
      
      const marketData = {
        pair,
        price: firstSignal.signal?.price,
        volatility: await this.getMarketVolatility(pair)
      };

      // 1a. Detect Market Regime and Adjust Weights
      let snapshot = null;
      if (this.strategyManager) {
        const strategy = await this.strategyManager.getStrategy(firstSignal.strategyId);
        if (strategy?.indicatorStates?.get(pair)) {
          snapshot = strategy.indicatorStates.get(pair).getSnapshot();
          const regime = this.regimeDetector.detect(snapshot);
          const weights = this.regimeDetector.getWeights(regime);
          
          logger.info(`Market regime detected: ${regime}. Adjusting weights:`, weights);
          this.signalAggregator.config.strategyWeights = weights;
        }
      }
      
      if (snapshot) {
        marketData.regime = snapshot.trendAlignment; // Pass trend info to aggregator
      }
      
      const aggregated = this.signalAggregator.aggregate(rawSignals, marketData);
      
      if (aggregated.action === 'hold') {
        logger.info(`Signal batch for ${pair} resulted in HOLD: ${aggregated.reason}`);
        return;
      }

      // 2. Risk Check
      const portfolioSummary = await this.positionManager?.getPortfolioSummary(userId) || {};
      
      // Safety check: block if portfolio value is unknown
      if (portfolioSummary.totalValue == null && this.positionManager) {
        logger.warn(`Cannot determine portfolio value for user ${userId}, blocking trade for safety`);
        eventBus.publish('trading:signalBlocked', {
          signal: aggregated,
          reason: ['Portfolio value unknown — cannot assess risk']
        });
        return;
      }

      let riskCheck = { allowed: true };
      if (this.riskManager) {
        riskCheck = await this.riskManager.checkTrade(
          aggregated,
          portfolioSummary,
          marketData
        );
      }
      
      if (!riskCheck.allowed) {
        logger.warn(`Aggregated signal blocked by risk manager:`, riskCheck.reason);
        eventBus.publish('trading:signalBlocked', {
          signal: aggregated,
          reason: riskCheck.reason
        });
        return;
      }

      // 3. Smart Order Routing
      const routedOrder = await this.orderRouter.routeOrder(
        riskCheck.adjustedParams || aggregated,
        marketData
      );

      // 4. Order Execution
      if (this.orderManager) {
        const orderResult = await this.orderManager.createOrder({
          userId,
          exchange: firstSignal.signal.exchange || 'kraken',
          pair: routedOrder.symbol,
          type: routedOrder.type,
          side: routedOrder.side,
          amount: routedOrder.amount,
          price: routedOrder.price,
          timeInForce: routedOrder.timeInForce,
          strategyId: 'aggregated_v2'
        });
        
        if (orderResult.success) {
          eventBus.publish('trading:orderCreated', {
            signal: aggregated,
            order: orderResult.data,
            routing: routedOrder
          });
          
          // Record trade for strategy performance
          this.signalAggregator.recordTradeResult(aggregated.id, { pnl: 0 }); // Will update on fill
        } else {
          logger.error('Failed to create order from aggregated signal:', orderResult.error);
        }
      }
    } catch (error) {
      logger.error('Error processing signal batch:', error);
    }
  }

  /**
   * Helper to get market volatility
   */
  async getMarketVolatility(pair) {
    if (!this.marketDataAggregator) return 0.02;
    // Simple mock or call to aggregator if it had ATR
    return 0.02;
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
            try {
              const fetchOptions = {
                method: action.method || 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  ...(action.headers || {})
                }
              };

              if (action.payload && fetchOptions.method !== 'GET' && fetchOptions.method !== 'HEAD') {
                fetchOptions.body = JSON.stringify(action.payload);
              }

              // Add a 5 second timeout to prevent hanging the trading engine
              fetchOptions.signal = AbortSignal.timeout(5000);

              const response = await fetch(action.url, fetchOptions);
              if (!response.ok) {
                logger.warn(`Webhook action failed with status ${response.status}: ${action.url}`);
              } else {
                logger.info(`Webhook action delivered successfully: ${action.url}`);
              }
            } catch (err) {
              logger.error(`Error executing webhook action to ${action.url}:`, err);
            }
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

      // Update SignalAggregator performance
      if (this.signalAggregator) {
        // Find the recent aggregated signal for this order
        const recentSignals = this.signalAggregator.getPerformance().recentSignals;
        const matchingSignal = recentSignals.find(s => 
          s.pair === order.pair && 
          s.action === order.side && 
          Math.abs(s.timestamp - Date.now()) < 3600000 // Last hour
        );
        
        if (matchingSignal) {
          this.signalAggregator.recordTradeResult(matchingSignal.id, {
            pnl: order.realizedPnL || 0
          });
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
    if (!this.positionManager) return null;
    
    try {
      const summary = await this.positionManager.getPortfolioSummary(userId);
      return summary?.totalValue ?? null;
    } catch (error) {
      logger.error(`Failed to get portfolio value for ${userId}:`, error);
      return null;
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
