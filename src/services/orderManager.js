const EventEmitter = require('events');
const Order = require('../models/order');
const OrderValidator = require('./orderValidator');
const logger = require('../utils/logger');
const redisClient = require('../utils/redis');

class OrderManager extends EventEmitter {
  constructor() {
    super();
    this.orders = new Map(); // In-memory storage for demo
    this.validator = new OrderValidator();
    this.orderQueue = [];
    this.processing = false;
    this.maxRetries = 3;
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

  // Process individual order
  async processOrder(order) {
    try {
      logger.info(`Processing order: ${order.id}`);

      // Update status to open
      order.updateStatus('open');
      await this.persistOrder(order);

      // Emit order opened event
      this.emit('orderOpened', order);

      // In production, this would send to exchange
      // For demo, simulate order execution
      await this.simulateOrderExecution(order);

    } catch (error) {
      logger.error(`Failed to process order ${order.id}:`, error);
      order.updateStatus('rejected', { error: error.message });
      await this.persistOrder(order);
      this.emit('orderRejected', order);
    }
  }

  // Simulate order execution (for demo)
  async simulateOrderExecution(order) {
    // Simulate delay
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Simulate partial fill for limit orders
    if (order.type === 'limit') {
      const fillAmount = order.amount * 0.5; // Fill 50%
      const fillPrice = order.price;

      order.addTrade({
        price: fillPrice,
        amount: fillAmount,
        fee: fillAmount * fillPrice * 0.001, // 0.1% fee
        timestamp: new Date()
      });

      await this.persistOrder(order);
      this.emit('orderPartiallyFilled', order);

      // Simulate remaining fill after delay
      await new Promise(resolve => setTimeout(resolve, 2000));

      order.addTrade({
        price: fillPrice,
        amount: order.remainingAmount,
        fee: order.remainingAmount * fillPrice * 0.001,
        timestamp: new Date()
      });

    } else {
      // Market order - fill immediately
      const fillPrice = order.price || 50000; // Mock price
      order.addTrade({
        price: fillPrice,
        amount: order.amount,
        fee: order.amount * fillPrice * 0.001,
        timestamp: new Date()
      });
    }

    await this.persistOrder(order);
    this.emit('orderFilled', order);

    logger.info(`Order ${order.id} executed successfully`);
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