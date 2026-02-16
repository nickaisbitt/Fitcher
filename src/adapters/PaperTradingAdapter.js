const ExchangeAdapter = require('./ExchangeAdapter');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

/**
 * PaperTradingAdapter - Simulates trading for paper trading mode
 * Uses real market data but with virtual balance
 */
class PaperTradingAdapter extends ExchangeAdapter {
  constructor(config = {}) {
    super('paper', {
      rateLimit: 1000, // No real rate limit for paper trading
      maxRetries: 0,
      ...config
    });
    
    this.virtualBalance = {
      USD: config.initialBalance || 100000,
      BTC: 0,
      ETH: 0
    };
    
    this.openOrders = new Map();
    this.orderHistory = [];
    this.trades = [];
    this.priceFeed = null; // Will be set externally
    
    // Slippage simulation (realistic)
    this.slippageModel = config.slippageModel || 'variable'; // 'fixed' | 'variable'
    this.baseSlippage = config.baseSlippage || 0.001; // 0.1%
    this.latencyMs = config.latencyMs || 500; // 500ms simulated latency
  }

  /**
   * Connect to paper trading (always succeeds)
   */
  async connect(credentials) {
    logger.info('✅ Paper trading mode activated');
    logger.info(`Virtual balance: $${this.virtualBalance.USD.toFixed(2)}`);
    this.isConnected = true;
    return true;
  }

  /**
   * Get virtual balance
   */
  async getBalance() {
    // Simulate latency
    await this.simulateLatency();
    return { ...this.virtualBalance };
  }

  /**
   * Create a paper order
   */
  async createOrder(orderParams) {
    await this.simulateLatency();
    
    const {
      symbol,
      type,
      side,
      amount,
      price,
      timeInForce = 'GTC'
    } = orderParams;

    // Get current market price
    const marketPrice = await this.getMarketPrice(symbol);
    
    // Calculate fill price with slippage
    const fillPrice = this.calculateFillPrice(marketPrice, side, type, price);
    
    // Validate balance
    if (side === 'buy') {
      const cost = amount * fillPrice;
      if (cost > this.virtualBalance.USD) {
        throw new Error(`Insufficient USD balance. Need: $${cost.toFixed(2)}, Have: $${this.virtualBalance.USD.toFixed(2)}`);
      }
    } else {
      const baseCurrency = symbol.split('/')[0];
      if (this.virtualBalance[baseCurrency] < amount) {
        throw new Error(`Insufficient ${baseCurrency} balance. Need: ${amount}, Have: ${this.virtualBalance[baseCurrency]}`);
      }
    }

    // Create order
    const orderId = `paper_${uuidv4()}`;
    const order = {
      id: orderId,
      exchangeOrderId: orderId,
      symbol: symbol.toUpperCase(),
      type: type,
      side: side,
      amount: amount,
      price: price || fillPrice,
      status: type === 'market' ? 'filled' : 'open',
      filled: type === 'market' ? amount : 0,
      remaining: type === 'market' ? 0 : amount,
      fillPrice: fillPrice,
      slippage: ((fillPrice - marketPrice) / marketPrice) * 100,
      fee: amount * fillPrice * 0.002, // 0.2% fee simulation
      timestamp: Date.now(),
      createdAt: Date.now()
    };

    // Store order
    this.openOrders.set(orderId, order);
    this.orderHistory.push(order);

    // Execute immediately for market orders
    if (type === 'market') {
      await this.executePaperTrade(order);
    }

    logger.info(`Paper order created: ${orderId} (${side} ${amount} ${symbol} @ ${fillPrice})`);
    
    return order;
  }

  /**
   * Cancel a paper order
   */
  async cancelOrder(orderId) {
    await this.simulateLatency();
    
    const order = this.openOrders.get(orderId);
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    order.status = 'cancelled';
    order.remaining = 0;
    this.openOrders.delete(orderId);

    logger.info(`Paper order cancelled: ${orderId}`);
    return true;
  }

  /**
   * Get order status
   */
  async getOrderStatus(orderId) {
    await this.simulateLatency();
    
    const order = this.openOrders.get(orderId) || 
                  this.orderHistory.find(o => o.id === orderId);
    
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    return {
      id: order.id,
      status: order.status,
      filled: order.filled,
      remaining: order.remaining,
      price: order.price,
      averagePrice: order.fillPrice,
      cost: order.filled * order.fillPrice,
      fee: order.fee,
      timestamp: order.timestamp
    };
  }

  /**
   * Get open orders
   */
  async getOpenOrders(symbol = null) {
    await this.simulateLatency();
    
    let orders = Array.from(this.openOrders.values());
    
    if (symbol) {
      orders = orders.filter(o => o.symbol === symbol.toUpperCase());
    }
    
    return orders;
  }

  /**
   * Get paper ticker (uses external price feed)
   */
  async getTicker(symbol) {
    await this.simulateLatency();
    
    if (!this.priceFeed) {
      throw new Error('Price feed not set');
    }

    const price = this.priceFeed.getPrice(symbol);
    if (!price) {
      throw new Error(`No price data for ${symbol}`);
    }

    return {
      symbol: symbol.toUpperCase(),
      bid: price * 0.999,
      ask: price * 1.001,
      last: price,
      timestamp: Date.now()
    };
  }

  /**
   * Get paper order book
   */
  async getOrderBook(symbol, limit = 10) {
    await this.simulateLatency();
    
    const ticker = await this.getTicker(symbol);
    const price = ticker.last;
    
    // Generate simulated order book around current price
    const bids = [];
    const asks = [];
    
    for (let i = 0; i < limit; i++) {
      const spread = 0.001 * (i + 1); // Increasing spread
      bids.push([price * (1 - spread), 0.5 + Math.random()]);
      asks.push([price * (1 + spread), 0.5 + Math.random()]);
    }
    
    return {
      symbol: symbol.toUpperCase(),
      bids: bids,
      asks: asks,
      timestamp: Date.now(),
      spread: asks[0][0] - bids[0][0]
    };
  }

  /**
   * Get trades
   */
  async getTrades(symbol, limit = 100) {
    await this.simulateLatency();
    
    return this.trades
      .filter(t => !symbol || t.symbol === symbol.toUpperCase())
      .slice(-limit);
  }

  /**
   * Set price feed (external data source)
   */
  setPriceFeed(priceFeed) {
    this.priceFeed = priceFeed;
  }

  /**
   * Get virtual balance
   */
  getVirtualBalance() {
    return { ...this.virtualBalance };
  }

  /**
   * Get paper trading stats
   */
  getStats() {
    const totalTrades = this.trades.length;
    const winningTrades = this.trades.filter(t => t.pnl > 0).length;
    const totalPnl = this.trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    
    return {
      virtualBalance: this.getVirtualBalance(),
      totalTrades: totalTrades,
      winRate: totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0,
      totalPnl: totalPnl,
      openOrders: this.openOrders.size,
      orderHistory: this.orderHistory.length
    };
  }

  /**
   * Reset paper trading (clear all data)
   */
  reset(initialBalance = 100000) {
    this.virtualBalance = {
      USD: initialBalance,
      BTC: 0,
      ETH: 0
    };
    this.openOrders.clear();
    this.orderHistory = [];
    this.trades = [];
    logger.info(`Paper trading reset. New balance: $${initialBalance}`);
  }

  // ==================== Private Methods ====================

  /**
   * Simulate network latency
   */
  async simulateLatency() {
    const latency = this.latencyMs * (0.5 + Math.random()); // Variable latency
    await new Promise(resolve => setTimeout(resolve, latency));
  }

  /**
   * Get current market price from feed
   */
  async getMarketPrice(symbol) {
    if (!this.priceFeed) {
      throw new Error('Price feed not set');
    }
    
    const price = this.priceFeed.getPrice(symbol);
    if (!price) {
      throw new Error(`No price data for ${symbol}`);
    }
    
    return price;
  }

  /**
   * Calculate realistic fill price with slippage
   */
  calculateFillPrice(marketPrice, side, orderType, limitPrice) {
    if (orderType === 'limit' && limitPrice) {
      // For limit orders, fill at limit price or better
      if (side === 'buy') {
        return Math.min(limitPrice, marketPrice * 1.001); // Slight slippage
      } else {
        return Math.max(limitPrice, marketPrice * 0.999);
      }
    }

    // For market orders, add slippage
    let slippage = this.baseSlippage;
    
    if (this.slippageModel === 'variable') {
      // Variable slippage based on order size (simulated)
      slippage *= (1 + Math.random());
    }
    
    if (side === 'buy') {
      return marketPrice * (1 + slippage);
    } else {
      return marketPrice * (1 - slippage);
    }
  }

  /**
   * Execute a paper trade
   */
  async executePaperTrade(order) {
    const baseCurrency = order.symbol.split('/')[0];
    const quoteCurrency = order.symbol.split('/')[1] || 'USD';
    
    if (order.side === 'buy') {
      // Deduct USD, add base currency
      const cost = order.amount * order.fillPrice;
      this.virtualBalance[quoteCurrency] -= (cost + order.fee);
      this.virtualBalance[baseCurrency] = (this.virtualBalance[baseCurrency] || 0) + order.amount;
    } else {
      // Deduct base currency, add USD
      const proceeds = order.amount * order.fillPrice;
      this.virtualBalance[baseCurrency] -= order.amount;
      this.virtualBalance[quoteCurrency] = (this.virtualBalance[quoteCurrency] || 0) + (proceeds - order.fee);
    }

    // Record trade
    const trade = {
      id: `trade_${uuidv4()}`,
      orderId: order.id,
      symbol: order.symbol,
      side: order.side,
      amount: order.amount,
      price: order.fillPrice,
      fee: order.fee,
      timestamp: Date.now(),
      balanceAfter: { ...this.virtualBalance }
    };
    
    this.trades.push(trade);
    this.openOrders.delete(order.id);

    logger.info(`Paper trade executed: ${order.side} ${order.amount} ${order.symbol} @ ${order.fillPrice}`);
    logger.info(`New balance: $${this.virtualBalance.USD.toFixed(2)}`);
  }
}

module.exports = PaperTradingAdapter;
