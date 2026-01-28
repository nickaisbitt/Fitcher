const EventEmitter = require('events');
const MarketDataWebSocket = require('./marketDataWebSocket');
const logger = require('../utils/logger');
const redisClient = require('../utils/redis');

class MarketDataAggregator extends EventEmitter {
  constructor() {
    super();
    this.exchanges = new Map();
    this.priceCache = new Map();
    this.orderBookCache = new Map();
    this.tradeCache = new Map();
    this.subscribers = new Map();
    this.aggregationInterval = 1000; // 1 second
    this.aggregationTimer = null;
  }

  // Initialize exchange WebSocket connections
  async initializeExchanges(exchangeConfigs) {
    logger.info('Initializing market data WebSocket connections...');
    
    for (const [exchangeName, config] of Object.entries(exchangeConfigs)) {
      try {
        const ws = new MarketDataWebSocket(exchangeName, config);
        
        // Set up event handlers
        ws.on('connected', () => this.handleExchangeConnected(exchangeName));
        ws.on('disconnected', (data) => this.handleExchangeDisconnected(exchangeName, data));
        ws.on('data', (data) => this.handleMarketData(exchangeName, data));
        ws.on('error', (error) => this.handleExchangeError(exchangeName, error));
        
        await ws.connect();
        this.exchanges.set(exchangeName, ws);
        
        logger.info(`✅ ${exchangeName} WebSocket initialized`);
      } catch (error) {
        logger.error(`❌ Failed to initialize ${exchangeName} WebSocket:`, error);
      }
    }
    
    // Start aggregation timer
    this.startAggregation();
    
    logger.info(`✅ Market data aggregator initialized with ${this.exchanges.size} exchanges`);
  }

  handleExchangeConnected(exchangeName) {
    logger.info(`[${exchangeName}] Exchange connected`);
    this.emit('exchangeConnected', { exchange: exchangeName });
  }

  handleExchangeDisconnected(exchangeName, data) {
    logger.warn(`[${exchangeName}] Exchange disconnected:`, data);
    this.emit('exchangeDisconnected', { exchange: exchangeName, ...data });
  }

  handleExchangeError(exchangeName, error) {
    logger.error(`[${exchangeName}] Exchange error:`, error);
    this.emit('exchangeError', { exchange: exchangeName, error });
  }

  handleMarketData(exchangeName, data) {
    try {
      // Normalize data format
      const normalizedData = this.normalizeData(exchangeName, data);
      
      // Cache the data
      this.cacheData(normalizedData);
      
      // Emit to subscribers
      this.emitToSubscribers(normalizedData);
      
      // Store in Redis for persistence
      this.persistToRedis(normalizedData);
      
    } catch (error) {
      logger.error(`Error handling market data from ${exchangeName}:`, error);
    }
  }

  normalizeData(exchangeName, data) {
    const { type, pair, data: rawData, timestamp } = data;
    
    switch (type) {
      case 'ticker':
        return {
          type: 'ticker',
          exchange: exchangeName,
          pair: this.normalizePair(pair),
          price: parseFloat(rawData.price) || 0,
          bid: parseFloat(rawData.bid) || 0,
          ask: parseFloat(rawData.ask) || 0,
          high: parseFloat(rawData.high) || 0,
          low: parseFloat(rawData.low) || 0,
          volume: parseFloat(rawData.volume) || 0,
          change: parseFloat(rawData.change) || 0,
          changePercent: parseFloat(rawData.changePercent) || 0,
          timestamp: timestamp || Date.now(),
          receivedAt: Date.now()
        };
        
      case 'orderbook':
      case 'orderbook_update':
        return {
          type: 'orderbook',
          exchange: exchangeName,
          pair: this.normalizePair(pair),
          bids: rawData.bids || [],
          asks: rawData.asks || [],
          timestamp: timestamp || Date.now(),
          receivedAt: Date.now()
        };
        
      case 'trade':
      case 'aggregated_trade':
        return {
          type: 'trade',
          exchange: exchangeName,
          pair: this.normalizePair(pair),
          price: parseFloat(rawData.price) || 0,
          volume: parseFloat(rawData.volume) || 0,
          side: rawData.side || 'unknown',
          time: rawData.time || timestamp || Date.now(),
          timestamp: timestamp || Date.now(),
          receivedAt: Date.now()
        };
        
      default:
        return {
          type: 'unknown',
          exchange: exchangeName,
          pair: this.normalizePair(pair),
          data: rawData,
          timestamp: timestamp || Date.now(),
          receivedAt: Date.now()
        };
    }
  }

  normalizePair(pair) {
    // Normalize pair format (BTC/USD, BTC-USD, BTCUSD -> BTC/USD)
    return pair.replace(/[-_]/g, '/').toUpperCase();
  }

  cacheData(data) {
    const cacheKey = `${data.type}:${data.exchange}:${data.pair}`;
    
    switch (data.type) {
      case 'ticker':
        this.priceCache.set(cacheKey, data);
        break;
      case 'orderbook':
        this.orderBookCache.set(cacheKey, data);
        break;
      case 'trade':
        if (!this.tradeCache.has(cacheKey)) {
          this.tradeCache.set(cacheKey, []);
        }
        const trades = this.tradeCache.get(cacheKey);
        trades.push(data);
        // Keep only last 1000 trades
        if (trades.length > 1000) {
          trades.shift();
        }
        break;
    }
  }

  emitToSubscribers(data) {
    const subscriptionKey = `${data.type}:${data.pair}`;
    const subscribers = this.subscribers.get(subscriptionKey);
    
    if (subscribers) {
      subscribers.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          logger.error('Error emitting to subscriber:', error);
        }
      });
    }
    
    // Also emit general market data event
    this.emit('marketData', data);
  }

  async persistToRedis(data) {
    try {
      const key = `market:${data.type}:${data.exchange}:${data.pair}`;
      
      // Store in Redis with TTL
      await redisClient.set(key, data, 300); // 5 minutes TTL
      
      // For trades, also add to sorted set for time-series
      if (data.type === 'trade') {
        const tradeKey = `trades:${data.exchange}:${data.pair}`;
        await redisClient.set(`${tradeKey}:${data.timestamp}`, data, 86400); // 24 hours
      }
    } catch (error) {
      logger.error('Error persisting to Redis:', error);
    }
  }

  startAggregation() {
    this.aggregationTimer = setInterval(() => {
      this.aggregatePrices();
    }, this.aggregationInterval);
  }

  stopAggregation() {
    if (this.aggregationTimer) {
      clearInterval(this.aggregationTimer);
      this.aggregationTimer = null;
    }
  }

  aggregatePrices() {
    // Group prices by pair across all exchanges
    const pairPrices = new Map();
    
    for (const [key, data] of this.priceCache) {
      if (data.type === 'ticker') {
        const pair = data.pair;
        
        if (!pairPrices.has(pair)) {
          pairPrices.set(pair, []);
        }
        
        pairPrices.get(pair).push({
          exchange: data.exchange,
          price: data.price,
          bid: data.bid,
          ask: data.ask,
          volume: data.volume,
          timestamp: data.timestamp
        });
      }
    }
    
    // Calculate aggregated prices
    for (const [pair, prices] of pairPrices) {
      if (prices.length > 0) {
        const aggregated = this.calculateAggregatedPrice(pair, prices);
        this.emit('aggregatedPrice', aggregated);
      }
    }
  }

  calculateAggregatedPrice(pair, prices) {
    // Calculate volume-weighted average price (VWAP)
    let totalVolume = 0;
    let weightedPriceSum = 0;
    let bestBid = 0;
    let bestAsk = Infinity;
    
    for (const price of prices) {
      totalVolume += price.volume;
      weightedPriceSum += price.price * price.volume;
      bestBid = Math.max(bestBid, price.bid);
      bestAsk = Math.min(bestAsk, price.ask);
    }
    
    const vwap = totalVolume > 0 ? weightedPriceSum / totalVolume : 0;
    const spread = bestAsk - bestBid;
    const spreadPercent = bestBid > 0 ? (spread / bestBid) * 100 : 0;
    
    return {
      pair,
      vwap,
      bestBid,
      bestAsk,
      spread,
      spreadPercent,
      totalVolume,
      exchangeCount: prices.length,
      exchanges: prices.map(p => p.exchange),
      timestamp: Date.now(),
      prices: prices
    };
  }

  // Subscribe to market data
  subscribe(type, pair, callback) {
    const subscriptionKey = `${type}:${pair}`;
    
    if (!this.subscribers.has(subscriptionKey)) {
      this.subscribers.set(subscriptionKey, new Set());
    }
    
    this.subscribers.get(subscriptionKey).add(callback);
    
    // Subscribe to exchanges
    for (const [exchangeName, ws] of this.exchanges) {
      ws.subscribe(type, pair);
    }
    
    logger.info(`Subscribed to ${subscriptionKey}`);
  }

  // Unsubscribe from market data
  unsubscribe(type, pair, callback) {
    const subscriptionKey = `${type}:${pair}`;
    const subscribers = this.subscribers.get(subscriptionKey);
    
    if (subscribers) {
      subscribers.delete(callback);
      
      if (subscribers.size === 0) {
        this.subscribers.delete(subscriptionKey);
        
        // Unsubscribe from exchanges
        for (const [exchangeName, ws] of this.exchanges) {
          ws.unsubscribe(type, pair);
        }
      }
    }
    
    logger.info(`Unsubscribed from ${subscriptionKey}`);
  }

  // Get cached price for a pair
  getPrice(pair, exchange = null) {
    if (exchange) {
      const key = `ticker:${exchange}:${pair}`;
      return this.priceCache.get(key);
    }
    
    // Get best price across all exchanges
    let bestPrice = null;
    let bestSpread = Infinity;
    
    for (const [key, data] of this.priceCache) {
      if (data.type === 'ticker' && data.pair === pair) {
        const spread = data.ask - data.bid;
        if (spread < bestSpread) {
          bestSpread = spread;
          bestPrice = data;
        }
      }
    }
    
    return bestPrice;
  }

  // Get order book for a pair
  getOrderBook(pair, exchange = null) {
    if (exchange) {
      const key = `orderbook:${exchange}:${pair}`;
      return this.orderBookCache.get(key);
    }
    
    // Aggregate order books from all exchanges
    const aggregatedBook = {
      pair,
      bids: [],
      asks: [],
      timestamp: Date.now()
    };
    
    for (const [key, data] of this.orderBookCache) {
      if (data.type === 'orderbook' && data.pair === pair) {
        aggregatedBook.bids.push(...data.bids.map(b => ({ ...b, exchange: data.exchange })));
        aggregatedBook.asks.push(...data.asks.map(a => ({ ...a, exchange: data.exchange })));
      }
    }
    
    // Sort by price
    aggregatedBook.bids.sort((a, b) => b.price - a.price);
    aggregatedBook.asks.sort((a, b) => a.price - b.price);
    
    return aggregatedBook;
  }

  // Get recent trades for a pair
  getRecentTrades(pair, exchange = null, limit = 100) {
    if (exchange) {
      const key = `trade:${exchange}:${pair}`;
      const trades = this.tradeCache.get(key) || [];
      return trades.slice(-limit);
    }
    
    // Get trades from all exchanges
    const allTrades = [];
    
    for (const [key, trades] of this.tradeCache) {
      if (key.includes(pair)) {
        allTrades.push(...trades);
      }
    }
    
    // Sort by timestamp and limit
    return allTrades
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  // Get status of all exchanges
  getStatus() {
    const status = {
      exchanges: {},
      totalSubscriptions: this.subscribers.size,
      cacheStats: {
        prices: this.priceCache.size,
        orderBooks: this.orderBookCache.size,
        trades: this.tradeCache.size
      }
    };
    
    for (const [exchangeName, ws] of this.exchanges) {
      status.exchanges[exchangeName] = ws.getStatus();
    }
    
    return status;
  }

  // Shutdown gracefully
  async shutdown() {
    logger.info('Shutting down market data aggregator...');
    
    this.stopAggregation();
    
    // Disconnect all exchanges
    for (const [exchangeName, ws] of this.exchanges) {
      ws.disconnect();
    }
    
    this.exchanges.clear();
    this.subscribers.clear();
    this.priceCache.clear();
    this.orderBookCache.clear();
    this.tradeCache.clear();
    
    logger.info('✅ Market data aggregator shut down');
  }
}

module.exports = MarketDataAggregator;