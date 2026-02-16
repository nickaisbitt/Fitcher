const logger = require('../utils/logger');

/**
 * ExchangeAdapter - Base class for exchange adapters
 * Defines the interface that all exchange adapters must implement
 */
class ExchangeAdapter {
  constructor(exchangeName, config = {}) {
    this.exchangeName = exchangeName;
    this.config = {
      rateLimit: config.rateLimit || 3, // requests per second
      maxRetries: config.maxRetries || 3,
      timeout: config.timeout || 30000, // 30 seconds
      ...config
    };
    this.isConnected = false;
    this.lastRequestTime = 0;
    this.requestCount = 0;
    this.ccxt = null; // Will be set by subclasses
  }

  /**
   * Connect to exchange with credentials
   * @param {Object} credentials - { apiKey, apiSecret, password? }
   */
  async connect(credentials) {
    throw new Error('connect() must be implemented by subclass');
  }

  /**
   * Disconnect from exchange
   */
  async disconnect() {
    this.isConnected = false;
    logger.info(`${this.exchangeName} adapter disconnected`);
  }

  /**
   * Get account balance
   * @returns {Object} - { USD: 1000, BTC: 0.5, ... }
   */
  async getBalance() {
    throw new Error('getBalance() must be implemented by subclass');
  }

  /**
   * Create a new order
   * @param {Object} orderParams
   * @returns {Object} - { id, status, filledAmount, remainingAmount, price }
   */
  async createOrder(orderParams) {
    throw new Error('createOrder() must be implemented by subclass');
  }

  /**
   * Cancel an order
   * @param {string} orderId
   * @returns {boolean}
   */
  async cancelOrder(orderId) {
    throw new Error('cancelOrder() must be implemented by subclass');
  }

  /**
   * Get order status
   * @param {string} orderId
   * @returns {Object}
   */
  async getOrderStatus(orderId) {
    throw new Error('getOrderStatus() must be implemented by subclass');
  }

  /**
   * Get open orders
   * @param {string} symbol - Optional pair filter
   * @returns {Array}
   */
  async getOpenOrders(symbol = null) {
    throw new Error('getOpenOrders() must be implemented by subclass');
  }

  /**
   * Get ticker price
   * @param {string} symbol - e.g., 'BTC/USD'
   * @returns {Object} - { bid, ask, last, volume, timestamp }
   */
  async getTicker(symbol) {
    throw new Error('getTicker() must be implemented by subclass');
  }

  /**
   * Get order book
   * @param {string} symbol
   * @param {number} limit
   * @returns {Object} - { bids: [[price, amount], ...], asks: [[price, amount], ...] }
   */
  async getOrderBook(symbol, limit = 10) {
    throw new Error('getOrderBook() must be implemented by subclass');
  }

  /**
   * Get recent trades
   * @param {string} symbol
   * @param {number} limit
   * @returns {Array}
   */
  async getTrades(symbol, limit = 100) {
    throw new Error('getTrades() must be implemented by subclass');
  }

  /**
   * Rate limiting - wait if necessary before making request
   */
  async rateLimit() {
    const now = Date.now();
    const minInterval = 1000 / this.config.rateLimit;
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < minInterval) {
      const waitTime = minInterval - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    this.lastRequestTime = Date.now();
    this.requestCount++;
  }

  /**
   * Execute with retry logic
   * @param {Function} fn - Async function to execute
   * @param {string} operationName - For logging
   */
  async executeWithRetry(fn, operationName) {
    let lastError;
    
    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        await this.rateLimit();
        return await fn();
      } catch (error) {
        lastError = error;
        
        // Don't retry on authentication errors
        if (error.message?.includes('authentication') || 
            error.message?.includes('Invalid API')) {
          logger.error(`${operationName} failed: Authentication error`, error);
          throw error;
        }
        
        // Don't retry on insufficient funds
        if (error.message?.includes('insufficient') || 
            error.message?.includes('balance')) {
          logger.error(`${operationName} failed: Insufficient funds`, error);
          throw error;
        }
        
        if (attempt < this.config.maxRetries) {
          const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
          logger.warn(`${operationName} failed (attempt ${attempt}), retrying in ${delay}ms...`, error.message);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    logger.error(`${operationName} failed after ${this.config.maxRetries} attempts`, lastError);
    throw lastError;
  }

  /**
   * Normalize symbol format (override in subclasses if needed)
   * @param {string} symbol - e.g., 'BTC/USD'
   * @returns {string}
   */
  normalizeSymbol(symbol) {
    return symbol.toUpperCase().replace('-', '/');
  }

  /**
   * Get adapter status
   */
  getStatus() {
    return {
      exchange: this.exchangeName,
      connected: this.isConnected,
      requests: this.requestCount,
      rateLimit: this.config.rateLimit
    };
  }
}

module.exports = ExchangeAdapter;
