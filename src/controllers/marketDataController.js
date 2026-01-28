const MarketDataAggregator = require('../services/marketDataAggregator');
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

class MarketDataController {
  constructor() {
    this.aggregator = new MarketDataAggregator();
    this.isInitialized = false;
  }

  // Initialize market data aggregator
  async initialize() {
    if (this.isInitialized) {
      return;
    }

    try {
      logger.info('Initializing market data controller...');
      
      // Configure exchanges (in production, these would come from database)
      const exchangeConfigs = {
        kraken: {
          maxReconnectAttempts: 5,
          reconnectDelay: 1000,
          heartbeatInterval: 30000
        },
        binance: {
          maxReconnectAttempts: 5,
          reconnectDelay: 1000,
          heartbeatInterval: 30000
        },
        coinbase: {
          maxReconnectAttempts: 5,
          reconnectDelay: 1000,
          heartbeatInterval: 30000
        }
      };

      await this.aggregator.initializeExchanges(exchangeConfigs);
      
      // Set up event listeners
      this.aggregator.on('exchangeConnected', (data) => {
        logger.info(`Exchange connected: ${data.exchange}`);
      });

      this.aggregator.on('exchangeDisconnected', (data) => {
        logger.warn(`Exchange disconnected: ${data.exchange}`);
      });

      this.aggregator.on('aggregatedPrice', (data) => {
        logger.debug(`Aggregated price for ${data.pair}: ${data.vwap}`);
      });

      this.isInitialized = true;
      logger.info('✅ Market data controller initialized');
    } catch (error) {
      logger.error('Failed to initialize market data controller:', error);
      throw error;
    }
  }

  // GET /api/market/price/:pair - Get current price for a pair
  getPrice = asyncHandler(async (req, res) => {
    const { pair } = req.params;
    const { exchange } = req.query;

    await this.initialize();

    const price = this.aggregator.getPrice(pair, exchange);

    if (!price) {
      return res.status(404).json({
        success: false,
        error: 'Price not found',
        code: 'PRICE_NOT_FOUND'
      });
    }

    res.json({
      success: true,
      data: {
        pair,
        exchange: price.exchange,
        price: price.price,
        bid: price.bid,
        ask: price.ask,
        high: price.high,
        low: price.low,
        volume: price.volume,
        change: price.change,
        changePercent: price.changePercent,
        timestamp: price.timestamp
      }
    });
  });

  // GET /api/market/prices - Get all current prices
  getAllPrices = asyncHandler(async (req, res) => {
    await this.initialize();

    const prices = [];
    const seenPairs = new Set();

    // Get unique pairs
    for (const [key, data] of this.aggregator.priceCache) {
      if (!seenPairs.has(data.pair)) {
        seenPairs.add(data.pair);
        prices.push({
          pair: data.pair,
          exchange: data.exchange,
          price: data.price,
          bid: data.bid,
          ask: data.ask,
          volume: data.volume,
          timestamp: data.timestamp
        });
      }
    }

    res.json({
      success: true,
      data: {
        prices,
        count: prices.length
      }
    });
  });

  // GET /api/market/orderbook/:pair - Get order book for a pair
  getOrderBook = asyncHandler(async (req, res) => {
    const { pair } = req.params;
    const { exchange, depth = 100 } = req.query;

    await this.initialize();

    const orderBook = this.aggregator.getOrderBook(pair, exchange);

    if (!orderBook || (orderBook.bids.length === 0 && orderBook.asks.length === 0)) {
      return res.status(404).json({
        success: false,
        error: 'Order book not found',
        code: 'ORDERBOOK_NOT_FOUND'
      });
    }

    // Limit depth
    const limitedDepth = parseInt(depth);
    const bids = orderBook.bids.slice(0, limitedDepth);
    const asks = orderBook.asks.slice(0, limitedDepth);

    res.json({
      success: true,
      data: {
        pair,
        bids,
        asks,
        spread: asks[0]?.price - bids[0]?.price || 0,
        timestamp: orderBook.timestamp
      }
    });
  });

  // GET /api/market/trades/:pair - Get recent trades for a pair
  getRecentTrades = asyncHandler(async (req, res) => {
    const { pair } = req.params;
    const { exchange, limit = 100 } = req.query;

    await this.initialize();

    const trades = this.aggregator.getRecentTrades(pair, exchange, parseInt(limit));

    res.json({
      success: true,
      data: {
        pair,
        trades,
        count: trades.length
      }
    });
  });

  // GET /api/market/aggregated/:pair - Get aggregated price across exchanges
  getAggregatedPrice = asyncHandler(async (req, res) => {
    const { pair } = req.params;

    await this.initialize();

    // Trigger aggregation
    this.aggregator.aggregatePrices();

    // Get prices from all exchanges
    const prices = [];
    for (const [key, data] of this.aggregator.priceCache) {
      if (data.type === 'ticker' && data.pair === pair.toUpperCase()) {
        prices.push({
          exchange: data.exchange,
          price: data.price,
          bid: data.bid,
          ask: data.ask,
          volume: data.volume,
          timestamp: data.timestamp
        });
      }
    }

    if (prices.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No price data available',
        code: 'NO_PRICE_DATA'
      });
    }

    // Calculate aggregated metrics
    const totalVolume = prices.reduce((sum, p) => sum + p.volume, 0);
    const vwap = totalVolume > 0 
      ? prices.reduce((sum, p) => sum + (p.price * p.volume), 0) / totalVolume 
      : 0;

    const bestBid = Math.max(...prices.map(p => p.bid));
    const bestAsk = Math.min(...prices.map(p => p.ask));
    const spread = bestAsk - bestBid;
    const spreadPercent = bestBid > 0 ? (spread / bestBid) * 100 : 0;

    res.json({
      success: true,
      data: {
        pair: pair.toUpperCase(),
        vwap,
        bestBid,
        bestAsk,
        spread,
        spreadPercent,
        totalVolume,
        exchangeCount: prices.length,
        exchanges: prices.map(p => p.exchange),
        prices,
        timestamp: Date.now()
      }
    });
  });

  // GET /api/market/status - Get market data status
  getStatus = asyncHandler(async (req, res) => {
    await this.initialize();

    const status = this.aggregator.getStatus();

    res.json({
      success: true,
      data: status
    });
  });

  // POST /api/market/subscribe - Subscribe to real-time market data
  subscribe = asyncHandler(async (req, res) => {
    const { type, pair } = req.body;

    await this.initialize();

    // Create a callback that will be used for WebSocket updates
    const callback = (data) => {
      // This would typically emit to a WebSocket connection
      logger.debug(`Received ${type} data for ${pair}:`, data);
    };

    this.aggregator.subscribe(type, pair, callback);

    res.json({
      success: true,
      message: `Subscribed to ${type} data for ${pair}`,
      data: { type, pair }
    });
  });

  // POST /api/market/unsubscribe - Unsubscribe from real-time market data
  unsubscribe = asyncHandler(async (req, res) => {
    const { type, pair } = req.body;

    await this.initialize();

    // Note: In a real implementation, you'd need to store the callback reference
    // This is a simplified version
    this.aggregator.unsubscribe(type, pair, () => {});

    res.json({
      success: true,
      message: `Unsubscribed from ${type} data for ${pair}`,
      data: { type, pair }
    });
  });

  // GET /api/market/pairs - Get available trading pairs
  getAvailablePairs = asyncHandler(async (req, res) => {
    await this.initialize();

    const pairs = new Set();
    
    // Collect all pairs from price cache
    for (const [key, data] of this.aggregator.priceCache) {
      if (data.pair) {
        pairs.add(data.pair);
      }
    }

    res.json({
      success: true,
      data: {
        pairs: Array.from(pairs).sort(),
        count: pairs.size
      }
    });
  });

  // GET /api/market/exchanges - Get available exchanges
  getAvailableExchanges = asyncHandler(async (req, res) => {
    await this.initialize();

    const exchanges = Array.from(this.aggregator.exchanges.keys());

    res.json({
      success: true,
      data: {
        exchanges,
        count: exchanges.length
      }
    });
  });
}

// Create singleton instance
const marketDataController = new MarketDataController();

module.exports = marketDataController;