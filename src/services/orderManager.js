const EventEmitter = require('events');
const Order = require('../models/order');
const OrderValidator = require('./orderValidator');
const logger = require('../utils/logger');
const redisClient = require('../utils/redis');
const ExchangeAdapterFactory = require('../adapters/ExchangeAdapterFactory');
const config = require('../config');
const database = require('../utils/database');
const { decrypt, isConfigured } = require('../utils/encryption');

class OrderManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.orders = new Map();
    this.validator = new OrderValidator();
    this.orderQueue = [];
    this.processing = false;
    this.maxRetries = 3;
    
    // Trading mode: 'paper' or 'live'
    this.tradingMode = options.tradingMode || config.TRADING_MODE || 'paper';
    
    // Exchange adapters per user
    this.exchangeAdapters = new Map();
    
    logger.info(`OrderManager initialized in ${this.tradingMode} mode`);
  }

  // Create new order
  async createOrder(orderParams) {
    try {
      logger.info('Creating new order:', orderParams);

      // Validate order parameters
      const validation = this.validator.validate(orderParams);
      if (!validation.valid) {
        logger.warn('Order validation failed:', validation.errors);
        return {
          success: false,
          error: 'Validation failed',
          details: validation.errors,
          warnings: validation.warnings
        };
      }

      // Create order instance
      const order = new Order(orderParams);

      // Store order
      this.orders.set(order.id, order);

      // Persist to Redis
      await this.persistOrder(order);

      // Add to processing queue
      this.orderQueue.push(order);

      // Start processing if not already running
      if (!this.processing) {
        this.processQueue();
      }

      logger.info(`Order created successfully: ${order.id}`);

      this.emit('orderCreated', order);

      return {
        success: true,
        message: 'Order created successfully',
        data: {
          orderId: order.id,
          status: order.status,
          summary: order.getSummary()
        },
        warnings: validation.warnings
      };

    } catch (error) {
      logger.error('Failed to create order:', error);
      return {
        success: false,
        error: 'Failed to create order',
        details: error.message
      };
    }
  }

  // Get order by ID
  async getOrder(orderId) {
    try {
      // Check memory cache first
      if (this.orders.has(orderId)) {
        return this.orders.get(orderId);
      }

      // Try to load from Redis
      const orderData = await redisClient.get(`order:${orderId}`);
      if (orderData) {
        const order = Order.fromJSON(orderData);
        this.orders.set(orderId, order);
        return order;
      }

      return null;
    } catch (error) {
      logger.error(`Failed to get order ${orderId}:`, error);
      return null;
    }
  }

  // Get all orders for a user
  async getUserOrders(userId, filters = {}) {
    try {
      const userOrders = [];

      for (const [orderId, order] of this.orders) {
        if (order.userId === userId) {
          // Apply filters
          if (filters.status && order.status !== filters.status) continue;
          if (filters.exchange && order.exchange !== filters.exchange) continue;
          if (filters.pair && order.pair !== filters.pair) continue;
          if (filters.side && order.side !== filters.side) continue;
          if (filters.type && order.type !== filters.type) continue;

          userOrders.push(order.getSummary());
        }
      }

      // Sort by created date (newest first)
      userOrders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      return userOrders;
    } catch (error) {
      logger.error(`Failed to get orders for user ${userId}:`, error);
      return [];
    }
  }

  // Update order
  async updateOrder(orderId, updates) {
    try {
      const order = await this.getOrder(orderId);

      if (!order) {
        return {
          success: false,
          error: 'Order not found',
          code: 'ORDER_NOT_FOUND'
        };
      }

      // Validate update
      const validation = this.validator.validateUpdate(order, updates);
      if (!validation.valid) {
        return {
          success: false,
          error: 'Update validation failed',
          details: validation.errors
        };
      }

      // Apply updates
      if (updates.price !== undefined) {
        order.price = parseFloat(updates.price);
      }

      if (updates.amount !== undefined) {
        order.amount = parseFloat(updates.amount);
        order.remainingAmount = order.amount - order.filledAmount;
      }

      if (updates.notes !== undefined) {
        order.notes = updates.notes;
      }

      order.updatedAt = new Date();

      // Persist updated order
      await this.persistOrder(order);

      logger.info(`Order ${orderId} updated successfully`);

      this.emit('orderUpdated', order);

      return {
        success: true,
        message: 'Order updated successfully',
        data: order.getSummary()
      };

    } catch (error) {
      logger.error(`Failed to update order ${orderId}:`, error);
      return {
        success: false,
        error: 'Failed to update order',
        details: error.message
      };
    }
  }

  // Cancel order
  async cancelOrder(orderId) {
    try {
      const order = await this.getOrder(orderId);

      if (!order) {
        return {
          success: false,
          error: 'Order not found',
          code: 'ORDER_NOT_FOUND'
        };
      }

      if (!order.canCancel()) {
        return {
          success: false,
          error: `Cannot cancel order with status: ${order.status}`,
          code: 'ORDER_CANNOT_CANCEL'
        };
      }

      // Update order status
      order.updateStatus('cancelled');

      // Persist updated order
      await this.persistOrder(order);

      logger.info(`Order ${orderId} cancelled successfully`);

      this.emit('orderCancelled', order);

      return {
        success: true,
        message: 'Order cancelled successfully',
        data: order.getSummary()
      };

    } catch (error) {
      logger.error(`Failed to cancel order ${orderId}:`, error);
      return {
        success: false,
        error: 'Failed to cancel order',
        details: error.message
      };
    }
  }

  // Process order queue
  async processQueue() {
    if (this.processing || this.orderQueue.length === 0) {
      return;
    }

    this.processing = true;

    try {
      while (this.orderQueue.length > 0) {
        const order = this.orderQueue.shift();
        await this.processOrder(order);
      }
    } catch (error) {
      logger.error('Error processing order queue:', error);
    } finally {
      this.processing = false;
    }
  }

  // Get or create exchange adapter for user
  async getExchangeAdapter(userId, exchange) {
    const cacheKey = `${userId}_${exchange}`;
    
    if (this.exchangeAdapters.has(cacheKey)) {
      return this.exchangeAdapters.get(cacheKey);
    }

    // Determine which adapter to use based on trading mode
    const usePaper = this.tradingMode === 'paper';
    const adapterName = usePaper ? 'paper' : exchange;
    
    try {
      let adapter;
      
      if (usePaper) {
        // Paper trading adapter
        adapter = ExchangeAdapterFactory.getPaperAdapter({
          initialBalance: 100000,
          slippageModel: 'variable'
        });
        await adapter.connect({});
      } else {
        // Live trading - get credentials from database
        const credentials = await this.getExchangeCredentials(userId, exchange);
        adapter = await ExchangeAdapterFactory.getAdapterForUser(
          userId,
          adapterName,
          credentials
        );
      }
      
      this.exchangeAdapters.set(cacheKey, adapter);
      logger.info(`${usePaper ? 'Paper' : 'Live'} adapter created for ${userId} on ${exchange}`);
      
      return adapter;
      
    } catch (error) {
      logger.error(`Failed to create adapter for ${userId} on ${exchange}:`, error);
      throw error;
    }
  }

  // Get exchange credentials from database
  async getExchangeCredentials(userId, exchange) {
    try {
      const prisma = database.getPrisma();

      const apiKeyRecord = await prisma.apiKey.findFirst({
        where: {
          userId,
          exchange: exchange.toLowerCase(),
          isActive: true
        }
      });

      if (apiKeyRecord && isConfigured()) {
        try {
          return {
            apiKey: decrypt(apiKeyRecord.apiKeyEncrypted),
            apiSecret: decrypt(apiKeyRecord.apiSecretEncrypted)
          };
        } catch (decryptError) {
          logger.error(`Failed to decrypt API keys for user ${userId} on ${exchange}:`, decryptError);
        }
      }
    } catch (dbError) {
      logger.warn(`Failed to retrieve API keys from database for user ${userId} on ${exchange}:`, dbError.message);
    }

    // Fallback: use environment variables for Kraken
    if (exchange.toLowerCase() === 'kraken') {
      return {
        apiKey: config.KRAKEN_API_KEY,
        apiSecret: config.KRAKEN_API_SECRET
      };
    }
    
    throw new Error(`No credentials configured for ${exchange}`);
  }

  // Process individual order
  async processOrder(order) {
    try {
      logger.info(`Processing order: ${order.id} (${this.tradingMode} mode)`);

      // Update status to open
      order.updateStatus('open');
      await this.persistOrder(order);

      // Emit order opened event
      this.emit('orderOpened', order);

      // Execute on exchange
      await this.executeOrderOnExchange(order);

    } catch (error) {
      logger.error(`Failed to process order ${order.id}:`, error);
      order.updateStatus('rejected', { error: error.message });
      await this.persistOrder(order);
      this.emit('orderRejected', order);
    }
  }

  // Execute order on exchange
  async executeOrderOnExchange(order) {
    try {
      // Get adapter for this user/exchange
      const adapter = await this.getExchangeAdapter(order.userId, order.exchange);
      
      // Check balance before executing
      const balance = await adapter.getBalance();
      logger.info(`Account balance:`, balance);
      
      // Create order on exchange
      const exchangeOrder = await adapter.createOrder({
        symbol: order.pair,
        type: order.type,
        side: order.side,
        amount: order.amount,
        price: order.price,
        timeInForce: order.timeInForce || 'GTC'
      });

      // Update order with exchange details
      order.exchangeOrderId = exchangeOrder.id;
      order.exchangeStatus = exchangeOrder.status;
      order.filledAmount = exchangeOrder.filled || 0;
      order.remainingAmount = exchangeOrder.remaining || order.amount;
      order.averagePrice = exchangeOrder.price;
      
      // Add trade if filled
      if (exchangeOrder.filled > 0) {
        order.addTrade({
          price: exchangeOrder.fillPrice || exchangeOrder.price,
          amount: exchangeOrder.filled,
          fee: exchangeOrder.fee || 0,
          timestamp: new Date()
        });
      }

      // Update status based on exchange response
      if (exchangeOrder.status === 'filled') {
        order.updateStatus('filled');
        await this.persistOrder(order);
        this.emit('orderFilled', order);
        logger.info(`Order ${order.id} filled: ${exchangeOrder.filled} @ ${exchangeOrder.price}`);
        
      } else if (exchangeOrder.status === 'open') {
        // Order is open on exchange, start polling for updates
        order.updateStatus('open');
        await this.persistOrder(order);
        this.emit('orderPartiallyFilled', order);
        
        // Start polling for order updates
        this.pollOrderStatus(order, adapter);
        
      } else {
        order.updateStatus(exchangeOrder.status);
        await this.persistOrder(order);
        this.emit('orderUpdated', order);
      }

    } catch (error) {
      logger.error(`Exchange execution failed for order ${order.id}:`, error);
      order.updateStatus('rejected', { 
        error: error.message,
        errorCode: error.code 
      });
      await this.persistOrder(order);
      this.emit('orderRejected', order);
      throw error;
    }
  }

  // Poll order status from exchange
  async pollOrderStatus(order, adapter) {
    const maxPolls = 60; // Poll for up to 5 minutes (5 second intervals)
    let polls = 0;
    
    const pollInterval = setInterval(async () => {
      try {
        polls++;
        
        // Get latest status from exchange
        const status = await adapter.getOrderStatus(order.exchangeOrderId);
        
        // Update order
        order.exchangeStatus = status.status;
        order.filledAmount = status.filled || order.filledAmount;
        order.remainingAmount = status.remaining || 0;
        order.averagePrice = status.averagePrice || order.averagePrice;
        
        // Add any new trades
        if (status.filled > order.filledAmount) {
          const newFillAmount = status.filled - order.filledAmount;
          order.addTrade({
            price: status.averagePrice || order.price,
            amount: newFillAmount,
            fee: status.fee || 0,
            timestamp: new Date()
          });
          
          await this.persistOrder(order);
          this.emit('orderPartiallyFilled', order);
        }
        
        // Check if order is complete
        if (status.status === 'filled' || status.status === 'cancelled' || status.status === 'rejected') {
          clearInterval(pollInterval);
          order.updateStatus(status.status);
          await this.persistOrder(order);
          
          if (status.status === 'filled') {
            this.emit('orderFilled', order);
            logger.info(`Order ${order.id} fully filled`);
          } else if (status.status === 'cancelled') {
            this.emit('orderCancelled', order);
            logger.info(`Order ${order.id} cancelled on exchange`);
          }
        }
        
        // Stop polling after max attempts
        if (polls >= maxPolls) {
          clearInterval(pollInterval);
          logger.warn(`Stopped polling order ${order.id} after ${maxPolls} attempts`);
        }
        
      } catch (error) {
        logger.error(`Error polling order ${order.id}:`, error);
        if (polls >= maxPolls) {
          clearInterval(pollInterval);
        }
      }
    }, 5000); // Poll every 5 seconds
  }

  // Get trading mode status
  getTradingMode() {
    return this.tradingMode;
  }

  // Shutdown - disconnect all adapters
  async shutdown() {
    logger.info('Shutting down OrderManager...');
    
    try {
      await ExchangeAdapterFactory.disconnectAll();
      this.exchangeAdapters.clear();
      logger.info('OrderManager shutdown complete');
    } catch (error) {
      logger.error('Error during OrderManager shutdown:', error);
      throw error;
    }
  }

  // Persist order to Redis
  async persistOrder(order) {
    try {
      const key = `order:${order.id}`;
      await redisClient.set(key, order.toJSON(), 86400); // 24 hours TTL

      // Also store in user's order list
      const userOrdersKey = `user:${order.userId}:orders`;
      const userOrders = await redisClient.get(userOrdersKey) || [];
      
      const existingIndex = userOrders.findIndex(id => id === order.id);
      if (existingIndex >= 0) {
        userOrders[existingIndex] = order.id;
      } else {
        userOrders.push(order.id);
      }

      await redisClient.set(userOrdersKey, userOrders, 86400);

    } catch (error) {
      logger.error(`Failed to persist order ${order.id}:`, error);
    }
  }

  // Get order statistics
  async getOrderStats(userId) {
    try {
      const orders = await this.getUserOrders(userId);

      const stats = {
        total: orders.length,
        byStatus: {},
        byExchange: {},
        byPair: {},
        totalFilled: 0,
        totalFee: 0,
        recentOrders: orders.slice(0, 10)
      };

      for (const order of orders) {
        // Count by status
        stats.byStatus[order.status] = (stats.byStatus[order.status] || 0) + 1;

        // Count by exchange
        stats.byExchange[order.exchange] = (stats.byExchange[order.exchange] || 0) + 1;

        // Count by pair
        stats.byPair[order.pair] = (stats.byPair[order.pair] || 0) + 1;

        // Sum filled value and fees
        if (order.status === 'filled' || order.status === 'partial') {
          stats.totalFilled += order.filledValue || 0;
          stats.totalFee += order.fee || 0;
        }
      }

      return stats;

    } catch (error) {
      logger.error(`Failed to get order stats for user ${userId}:`, error);
      return null;
    }
  }

  // Get active orders count
  getActiveOrdersCount() {
    let count = 0;
    for (const order of this.orders.values()) {
      if (order.isActive()) {
        count++;
      }
    }
    return count;
  }

  // Cleanup completed orders (older than 24 hours)
  async cleanupOldOrders() {
    try {
      const cutoffTime = Date.now() - (24 * 60 * 60 * 1000); // 24 hours ago
      let cleanedCount = 0;

      for (const [orderId, order] of this.orders) {
        if (!order.isActive() && new Date(order.updatedAt).getTime() < cutoffTime) {
          this.orders.delete(orderId);
          cleanedCount++;
        }
      }

      logger.info(`Cleaned up ${cleanedCount} old orders`);
      return cleanedCount;

    } catch (error) {
      logger.error('Failed to cleanup old orders:', error);
      return 0;
    }
  }
}

module.exports = OrderManager;