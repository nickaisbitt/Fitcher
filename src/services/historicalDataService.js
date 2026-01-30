const ccxt = require('ccxt');
const logger = require('../utils/logger');

/**
 * HistoricalDataService - Fetches and manages historical OHLCV data
 * Uses CCXT for exchange data access
 */
class HistoricalDataService {
  constructor() {
    this.exchanges = new Map();
    this.cache = new Map();
    this.cacheMaxSize = 1000; // Max candles per pair/timeframe
  }

  /**
   * Initialize exchange connection
   * @param {string} exchangeName - Exchange name (e.g., 'kraken', 'binance')
   * @param {Object} config - Exchange configuration
   */
  async initializeExchange(exchangeName, config = {}) {
    try {
      if (this.exchanges.has(exchangeName)) {
        return this.exchanges.get(exchangeName);
      }

      const ExchangeClass = ccxt[exchangeName.toLowerCase()];
      if (!ExchangeClass) {
        throw new Error(`Exchange ${exchangeName} not supported by CCXT`);
      }

      const exchange = new ExchangeClass({
        enableRateLimit: true,
        ...config
      });

      // Load markets
      await exchange.loadMarkets();
      
      this.exchanges.set(exchangeName, exchange);
      logger.info(`✅ Exchange ${exchangeName} initialized for historical data`);
      
      return exchange;
    } catch (error) {
      logger.error(`Failed to initialize exchange ${exchangeName}:`, error);
      throw error;
    }
  }

  /**
   * Fetch OHLCV data
   * @param {string} exchangeName - Exchange name
   * @param {string} symbol - Trading pair (e.g., 'BTC/USD')
   * @param {string} timeframe - Timeframe (e.g., '1m', '1h', '1d')
   * @param {number} since - Start timestamp (ms)
   * @param {number} limit - Number of candles to fetch
   */
  async fetchOHLCV(exchangeName, symbol, timeframe = '1h', since = null, limit = 500) {
    try {
      const exchange = await this.initializeExchange(exchangeName);
      
      // Normalize symbol
      const normalizedSymbol = this.normalizeSymbol(symbol, exchange);
      
      // Check cache first
      const cacheKey = `${exchangeName}:${normalizedSymbol}:${timeframe}`;
      const cached = this.getFromCache(cacheKey, since, limit);
      if (cached) {
        logger.debug(`Using cached OHLCV data for ${cacheKey}`);
        return cached;
      }

      // Calculate default since if not provided (Binance requires startTime)
      let fetchSince = since;
      if (!fetchSince) {
        const timeframeMs = this.parseTimeframe(timeframe);
        fetchSince = Date.now() - (limit * timeframeMs);
      }
      
      // Fetch from exchange
      logger.info(`Fetching OHLCV for ${normalizedSymbol} (${timeframe}) from ${exchangeName}...`);
      
      const ohlcv = await exchange.fetchOHLCV(
        normalizedSymbol,
        timeframe,
        fetchSince,
        limit
      );

      if (!ohlcv || ohlcv.length === 0) {
        logger.warn(`No OHLCV data returned for ${normalizedSymbol}`);
        return [];
      }

      // Format data
      const formatted = ohlcv.map(candle => ({
        timestamp: candle[0],
        open: candle[1],
        high: candle[2],
        low: candle[3],
        close: candle[4],
        volume: candle[5]
      }));

      // Store in cache
      this.addToCache(cacheKey, formatted);

      logger.info(`✅ Fetched ${formatted.length} candles for ${normalizedSymbol}`);
      
      return formatted;
    } catch (error) {
      logger.error(`Failed to fetch OHLCV for ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Fetch historical data for a date range
   * @param {string} exchangeName - Exchange name
   * @param {string} symbol - Trading pair
   * @param {string} timeframe - Timeframe
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   */
  async fetchRange(exchangeName, symbol, timeframe = '1h', startDate, endDate) {
    try {
      const exchange = await this.initializeExchange(exchangeName);
      const timeframeMs = this.parseTimeframe(timeframe);
      
      let since = startDate.getTime();
      const endTime = endDate.getTime();
      const allData = [];
      
      logger.info(`Fetching OHLCV range: ${startDate.toISOString()} to ${endDate.toISOString()}`);

      // Fetch in chunks to handle pagination
      while (since < endTime) {
        const chunk = await this.fetchOHLCV(
          exchangeName,
          symbol,
          timeframe,
          since,
          1000 // Max per request
        );

        if (chunk.length === 0) break;

        // Filter to date range
        const filtered = chunk.filter(c => c.timestamp <= endTime);
        allData.push(...filtered);

        // Update since for next chunk
        const lastTimestamp = chunk[chunk.length - 1].timestamp;
        if (lastTimestamp <= since) break; // No progress
        
        since = lastTimestamp + timeframeMs;

        // Rate limiting
        await this.sleep(exchange.rateLimit);
      }

      logger.info(`✅ Fetched total ${allData.length} candles for date range`);
      
      return allData;
    } catch (error) {
      logger.error(`Failed to fetch OHLCV range:`, error);
      throw error;
    }
  }

  /**
   * Get available trading pairs for an exchange
   * @param {string} exchangeName - Exchange name
   */
  async getAvailablePairs(exchangeName) {
    try {
      const exchange = await this.initializeExchange(exchangeName);
      return Object.keys(exchange.markets);
    } catch (error) {
      logger.error(`Failed to get pairs for ${exchangeName}:`, error);
      return [];
    }
  }

  /**
   * Get available timeframes for an exchange
   * @param {string} exchangeName - Exchange name
   */
  async getAvailableTimeframes(exchangeName) {
    try {
      const exchange = await this.initializeExchange(exchangeName);
      return exchange.timeframes ? Object.keys(exchange.timeframes) : [];
    } catch (error) {
      logger.error(`Failed to get timeframes for ${exchangeName}:`, error);
      return [];
    }
  }

  /**
   * Normalize symbol format
   * @param {string} symbol - Symbol (e.g., 'BTC/USD', 'BTC-USD')
   * @param {Object} exchange - CCXT exchange instance
   */
  normalizeSymbol(symbol, exchange) {
    // Try to find matching market
    const markets = Object.keys(exchange.markets);
    
    // Direct match
    if (markets.includes(symbol)) {
      return symbol;
    }

    // Handle exchange-specific conversions
    if (exchange.id === 'binance') {
      // Binance uses USDT for USD pairs
      if (symbol === 'BTC/USD') return 'BTC/USDT';
      if (symbol === 'ETH/USD') return 'ETH/USDT';
      if (symbol === 'LTC/USD') return 'LTC/USDT';
    }
    
    if (exchange.id === 'kraken') {
      // Kraken uses XBT for BTC
      if (symbol === 'BTC/USD') return 'XBT/USD';
      if (symbol === 'BTC/EUR') return 'XBT/EUR';
    }

    // Try different formats
    const formats = [
      symbol.replace('-', '/'),
      symbol.replace('/', '-'),
      symbol.replace('/', ''),
      symbol.replace('-', '')
    ];

    for (const format of formats) {
      if (markets.includes(format)) {
        return format;
      }
    }

    // Return original if no match found
    return symbol;
  }

  /**
   * Parse timeframe string to milliseconds
   * @param {string} timeframe - Timeframe (e.g., '1m', '1h', '1d')
   */
  parseTimeframe(timeframe) {
    const units = {
      'm': 60 * 1000,
      'h': 60 * 60 * 1000,
      'd': 24 * 60 * 60 * 1000,
      'w': 7 * 24 * 60 * 60 * 1000,
      'M': 30 * 24 * 60 * 60 * 1000
    };

    const match = timeframe.match(/^(\d+)([mhdwM])$/);
    if (!match) {
      throw new Error(`Invalid timeframe format: ${timeframe}`);
    }

    const [, amount, unit] = match;
    return parseInt(amount) * units[unit];
  }

  /**
   * Get data from cache
   * @param {string} key - Cache key
   * @param {number} since - Start timestamp
   * @param {number} limit - Limit
   */
  getFromCache(key, since, limit) {
    if (!this.cache.has(key)) return null;

    const data = this.cache.get(key);
    
    // Filter by since if provided
    let filtered = data;
    if (since) {
      filtered = data.filter(c => c.timestamp >= since);
    }

    // Apply limit
    if (limit && filtered.length >= limit) {
      return filtered.slice(0, limit);
    }

    return null; // Need to fetch more data
  }

  /**
   * Add data to cache
   * @param {string} key - Cache key
   * @param {Array} data - OHLCV data
   */
  addToCache(key, data) {
    if (!this.cache.has(key)) {
      this.cache.set(key, []);
    }

    const existing = this.cache.get(key);
    
    // Merge and deduplicate
    const merged = [...existing, ...data];
    merged.sort((a, b) => a.timestamp - b.timestamp);
    
    // Remove duplicates
    const unique = merged.filter((item, index, self) =>
      index === self.findIndex(t => t.timestamp === item.timestamp)
    );

    // Trim to max size
    if (unique.length > this.cacheMaxSize) {
      unique.splice(0, unique.length - this.cacheMaxSize);
    }

    this.cache.set(key, unique);
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
    logger.info('Historical data cache cleared');
  }

  /**
   * Sleep for milliseconds
   * @param {number} ms - Milliseconds
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = HistoricalDataService;
