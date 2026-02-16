const ccxt = require('ccxt');
const ExchangeAdapter = require('./ExchangeAdapter');
const logger = require('../utils/logger');

/**
 * KrakenAdapter - Real Kraken exchange trading via CCXT
 */
class KrakenAdapter extends ExchangeAdapter {
  constructor(config = {}) {
    super('kraken', {
      rateLimit: 3, // Kraken: 3 requests per second for most endpoints
      maxRetries: 3,
      timeout: 30000,
      ...config
    });
    
    this.exchange = null;
    this.marketSymbols = new Map(); // Cache market symbols
  }

  /**
   * Connect to Kraken with API credentials
   */
  async connect(credentials) {
    try {
      logger.info('Connecting to Kraken...');
      
      this.exchange = new ccxt.kraken({
        apiKey: credentials.apiKey,
        secret: credentials.apiSecret,
        enableRateLimit: true, // CCXT handles rate limiting
        timeout: this.config.timeout
      });
      
      // Load markets to validate connection
      await this.exchange.loadMarkets();
      
      // Cache symbol mappings
      for (const [symbol, market] of Object.entries(this.exchange.markets)) {
        this.marketSymbols.set(symbol, market);
      }
      
      // Test connection with balance check
      const balance = await this.getBalance();
      logger.info('✅ Connected to Kraken successfully');
      logger.info(`Account balance: ${JSON.stringify(balance)}`);
      
      this.isConnected = true;
      return true;
      
    } catch (error) {
      logger.error('Failed to connect to Kraken:', error);
      throw error;
    }
  }

  /**
   * Get account balance
   */
  async getBalance() {
    return await this.executeWithRetry(async () => {
      const balance = await this.exchange.fetchBalance();
      
      // Filter out zero balances
      const nonZeroBalances = {};
      for (const [currency, amount] of Object.entries(balance.total)) {
        if (amount > 0) {
          nonZeroBalances[currency] = amount;
        }
      }
      
      return nonZeroBalances;
    }, 'getBalance');
  }

  /**
   * Create a new order
   */
  async createOrder(orderParams) {
    return await this.executeWithRetry(async () => {
      const {
        symbol,
        type,        // 'market' or 'limit'
        side,        // 'buy' or 'sell'
        amount,      // Base currency amount
        price,       // Limit price (for limit orders)
        timeInForce = 'GTC' // Good Till Canceled
      } = orderParams;

      // Validate symbol
      const krakenSymbol = this.normalizeSymbol(symbol);
      if (!this.marketSymbols.has(krakenSymbol)) {
        throw new Error(`Invalid symbol: ${krakenSymbol}`);
      }

      // Create order
      logger.info(`Creating ${type} ${side} order: ${amount} ${krakenSymbol} @ ${price || 'market'}`);
      
      const order = await this.exchange.createOrder(
        krakenSymbol,
        type,
        side,
        amount,
        price,
        { timeInForce }
      );

      logger.info(`Order created: ${order.id}`);
      
      return {
        id: order.id,
        exchangeOrderId: order.id,
        symbol: krakenSymbol,
        type: type,
        side: side,
        amount: amount,
        price: price,
        status: this.mapOrderStatus(order.status),
        filled: order.filled || 0,
        remaining: order.remaining || amount,
        timestamp: order.timestamp || Date.now(),
        raw: order
      };
    }, 'createOrder');
  }

  /**
   * Cancel an order
   */
  async cancelOrder(orderId) {
    return await this.executeWithRetry(async () => {
      logger.info(`Cancelling order: ${orderId}`);
      const result = await this.exchange.cancelOrder(orderId);
      logger.info(`Order ${orderId} cancelled`);
      return true;
    }, 'cancelOrder');
  }

  /**
   * Get order status
   */
  async getOrderStatus(orderId) {
    return await this.executeWithRetry(async () => {
      const order = await this.exchange.fetchOrder(orderId);
      
      return {
        id: order.id,
        status: this.mapOrderStatus(order.status),
        filled: order.filled || 0,
        remaining: order.remaining || 0,
        price: order.price,
        averagePrice: order.average,
        cost: order.cost,
        fee: order.fee,
        timestamp: order.timestamp,
        raw: order
      };
    }, 'getOrderStatus');
  }

  /**
   * Get open orders
   */
  async getOpenOrders(symbol = null) {
    return await this.executeWithRetry(async () => {
      const krakenSymbol = symbol ? this.normalizeSymbol(symbol) : undefined;
      const orders = await this.exchange.fetchOpenOrders(krakenSymbol);
      
      return orders.map(order => ({
        id: order.id,
        symbol: order.symbol,
        type: order.type,
        side: order.side,
        amount: order.amount,
        price: order.price,
        status: this.mapOrderStatus(order.status),
        filled: order.filled || 0,
        remaining: order.remaining || 0,
        timestamp: order.timestamp
      }));
    }, 'getOpenOrders');
  }

  /**
   * Get ticker price
   */
  async getTicker(symbol) {
    return await this.executeWithRetry(async () => {
      const krakenSymbol = this.normalizeSymbol(symbol);
      const ticker = await this.exchange.fetchTicker(krakenSymbol);
      
      return {
        symbol: krakenSymbol,
        bid: ticker.bid,
        ask: ticker.ask,
        last: ticker.last,
        high: ticker.high,
        low: ticker.low,
        volume: ticker.baseVolume,
        timestamp: ticker.timestamp,
        change: ticker.change,
        changePercent: ticker.percentage
      };
    }, 'getTicker');
  }

  /**
   * Get order book
   */
  async getOrderBook(symbol, limit = 10) {
    return await this.executeWithRetry(async () => {
      const krakenSymbol = this.normalizeSymbol(symbol);
      const orderBook = await this.exchange.fetchOrderBook(krakenSymbol, limit);
      
      return {
        symbol: krakenSymbol,
        bids: orderBook.bids.slice(0, limit), // [price, amount]
        asks: orderBook.asks.slice(0, limit),
        timestamp: orderBook.timestamp,
        spread: orderBook.asks[0][0] - orderBook.bids[0][0]
      };
    }, 'getOrderBook');
  }

  /**
   * Get recent trades
   */
  async getTrades(symbol, limit = 100) {
    return await this.executeWithRetry(async () => {
      const krakenSymbol = this.normalizeSymbol(symbol);
      const trades = await this.exchange.fetchTrades(krakenSymbol, undefined, limit);
      
      return trades.map(trade => ({
        id: trade.id,
        timestamp: trade.timestamp,
        price: trade.price,
        amount: trade.amount,
        side: trade.side,
        cost: trade.cost
      }));
    }, 'getTrades');
  }

  /**
   * Map CCXT order status to our standard status
   */
  mapOrderStatus(ccxtStatus) {
    const statusMap = {
      'open': 'open',
      'closed': 'filled',
      'canceled': 'cancelled',
      'cancelled': 'cancelled',
      'pending': 'pending',
      'expired': 'expired',
      'rejected': 'rejected'
    };
    
    return statusMap[ccxtStatus] || ccxtStatus;
  }

  /**
   * Get trading fees
   */
  async getTradingFees() {
    return await this.executeWithRetry(async () => {
      const fees = await this.exchange.fetchTradingFees();
      return fees;
    }, 'getTradingFees');
  }

  /**
   * Get exchange status
   */
  async getExchangeStatus() {
    return await this.executeWithRetry(async () => {
      const status = await this.exchange.fetchStatus();
      return {
        status: status.status,
        updated: status.updated,
        eta: status.eta
      };
    }, 'getExchangeStatus');
  }

  /**
   * Normalize symbol for Kraken
   * Kraken uses XBT instead of BTC
   */
  normalizeSymbol(symbol) {
    let normalized = symbol.toUpperCase();
    
    // Handle BTC -> XBT conversion for Kraken
    if (normalized.includes('BTC')) {
      normalized = normalized.replace('BTC', 'XBT');
    }
    
    // Ensure / separator
    if (!normalized.includes('/')) {
      // Try to infer pair (e.g., BTCUSD -> BTC/USD)
      if (normalized.endsWith('USD')) {
        const base = normalized.slice(0, -3);
        normalized = `${base}/USD`;
      }
    }
    
    return normalized;
  }
}

module.exports = KrakenAdapter;
