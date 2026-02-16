const KrakenAdapter = require('./KrakenAdapter');
const PaperTradingAdapter = require('./PaperTradingAdapter');
const logger = require('../utils/logger');

/**
 * ExchangeAdapterFactory - Factory for creating exchange adapters
 * Supports multiple exchanges and paper trading mode
 */
class ExchangeAdapterFactory {
  constructor() {
    this.adapters = new Map();
    this.config = {
      kraken: {
        rateLimit: 3,
        maxRetries: 3
      },
      paper: {
        rateLimit: 1000,
        initialBalance: 100000
      }
    };
  }

  /**
   * Create and configure an exchange adapter
   * @param {string} exchangeName - 'kraken', 'binance', 'coinbase', 'paper'
   * @param {Object} options - Configuration options
   * @returns {ExchangeAdapter}
   */
  createAdapter(exchangeName, options = {}) {
    const name = exchangeName.toLowerCase();
    
    // Check if we already have an adapter for this exchange
    const cacheKey = `${name}_${options.userId || 'default'}`;
    if (this.adapters.has(cacheKey)) {
      logger.debug(`Reusing cached adapter for ${name}`);
      return this.adapters.get(cacheKey);
    }

    let adapter;
    const config = { ...this.config[name], ...options };

    switch (name) {
      case 'kraken':
        adapter = new KrakenAdapter(config);
        break;
        
      case 'paper':
      case 'papertrading':
      case 'simulation':
        adapter = new PaperTradingAdapter(config);
        break;
        
      default:
        throw new Error(`Unsupported exchange: ${exchangeName}. Supported: kraken, paper`);
    }

    // Cache adapter
    this.adapters.set(cacheKey, adapter);
    logger.info(`Created ${name} adapter`);
    
    return adapter;
  }

  /**
   * Get adapter for user (with their credentials)
   * @param {string} userId
   * @param {string} exchangeName
   * @param {Object} credentials
   */
  async getAdapterForUser(userId, exchangeName, credentials) {
    const adapter = this.createAdapter(exchangeName, { userId });
    
    if (!adapter.isConnected) {
      await adapter.connect(credentials);
    }
    
    return adapter;
  }

  /**
   * Get paper trading adapter
   * @param {Object} options
   */
  getPaperAdapter(options = {}) {
    return this.createAdapter('paper', {
      initialBalance: options.initialBalance || 100000,
      slippageModel: options.slippageModel || 'variable',
      ...options
    });
  }

  /**
   * Get Kraken adapter
   * @param {Object} credentials - { apiKey, apiSecret }
   */
  async getKrakenAdapter(credentials) {
    const adapter = this.createAdapter('kraken');
    
    if (!adapter.isConnected) {
      await adapter.connect(credentials);
    }
    
    return adapter;
  }

  /**
   * Remove adapter from cache
   * @param {string} exchangeName
   * @param {string} userId
   */
  removeAdapter(exchangeName, userId = 'default') {
    const cacheKey = `${exchangeName.toLowerCase()}_${userId}`;
    const adapter = this.adapters.get(cacheKey);
    
    if (adapter) {
      adapter.disconnect();
      this.adapters.delete(cacheKey);
      logger.info(`Removed adapter for ${exchangeName}`);
    }
  }

  /**
   * Get all active adapters
   */
  getActiveAdapters() {
    return Array.from(this.adapters.entries()).map(([key, adapter]) => ({
      key,
      exchange: adapter.exchangeName,
      connected: adapter.isConnected,
      status: adapter.getStatus()
    }));
  }

  /**
   * Disconnect all adapters
   */
  async disconnectAll() {
    logger.info('Disconnecting all exchange adapters...');
    
    for (const [key, adapter] of this.adapters) {
      try {
        await adapter.disconnect();
        logger.info(`Disconnected ${key}`);
      } catch (error) {
        logger.error(`Error disconnecting ${key}:`, error);
      }
    }
    
    this.adapters.clear();
    logger.info('All adapters disconnected');
  }

  /**
   * Get supported exchanges
   */
  getSupportedExchanges() {
    return ['kraken', 'paper'];
  }

  /**
   * Check if exchange is supported
   * @param {string} exchangeName
   */
  isSupported(exchangeName) {
    return this.getSupportedExchanges().includes(exchangeName.toLowerCase());
  }
}

// Export singleton instance
module.exports = new ExchangeAdapterFactory();
