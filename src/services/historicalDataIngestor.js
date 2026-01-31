const ccxt = require('ccxt');
const logger = require('../utils/logger');
const database = require('../utils/database');
const ParquetWriter = require('./parquetWriter');

/**
 * HistoricalDataIngestor - Fetches and stores historical OHLCV data
 * Uses CCXT for exchange access, stores in Parquet files
 */
class HistoricalDataIngestor {
  constructor(config = {}) {
    this.config = {
      exchange: config.exchange || 'binance',
      rateLimit: config.rateLimit || 100, // ms between requests
      chunkSize: config.chunkSize || 1000, // candles per request
      maxRetries: config.maxRetries || 3,
      retryDelay: config.retryDelay || 5000,
      ...config
    };

    this.parquetWriter = new ParquetWriter();
    this.exchange = null;
    this.isRunning = false;
    this.currentJob = null;
  }

  /**
   * Initialize the ingestor
   */
  async initialize() {
    await this.parquetWriter.initialize();
    this.exchange = await this.initializeExchange();
    logger.info(`HistoricalDataIngestor initialized with ${this.config.exchange}`);
  }

  /**
   * Initialize exchange connection
   */
  async initializeExchange() {
    try {
      const ExchangeClass = ccxt[this.config.exchange];
      if (!ExchangeClass) {
        throw new Error(`Exchange ${this.config.exchange} not supported`);
      }

      const exchange = new ExchangeClass({
        enableRateLimit: true,
        rateLimit: this.config.rateLimit,
        options: {
          defaultType: 'spot'
        }
      });

      await exchange.loadMarkets();
      logger.info(`✅ Exchange ${this.config.exchange} initialized`);
      return exchange;
    } catch (error) {
      logger.error(`Failed to initialize exchange:`, error);
      throw error;
    }
  }

  /**
   * Ingest historical data for a pair/timeframe
   * @param {string} pair - Trading pair (e.g., 'BTC/USD')
   * @param {string} timeframe - Timeframe (1h, 1d, etc.)
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date (defaults to now)
   * @param {number} priority - Job priority (0=low, 1=normal, 2=high)
   */
  async ingest(pair, timeframe, startDate, endDate = new Date(), priority = 1) {
    const jobId = `ingest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Create job record
    const job = await this.createJob(jobId, pair, timeframe, startDate, endDate, priority);
    
    logger.info(`Starting ingestion job ${jobId}: ${pair} ${timeframe} from ${startDate.toISOString()} to ${endDate.toISOString()}`);

    try {
      await this.updateJobStatus(jobId, 'RUNNING', { startedAt: new Date() });
      
      let totalFetched = 0;
      let totalStored = 0;
      let currentDate = new Date(startDate);
      const endTimestamp = endDate.getTime();

      while (currentDate.getTime() < endTimestamp) {
        // Check if job was cancelled
        const currentJob = await this.getJob(jobId);
        if (currentJob.status === 'CANCELLED') {
          logger.info(`Job ${jobId} was cancelled`);
          return { status: 'cancelled', candlesFetched: totalFetched };
        }

        // Fetch chunk
        const chunk = await this.fetchChunk(pair, timeframe, currentDate, this.config.chunkSize);
        
        if (chunk.length === 0) {
          logger.warn(`No data returned for chunk starting ${currentDate.toISOString()}`);
          break;
        }

        // Validate and filter
        const validChunk = this.validateCandles(chunk);
        
        if (validChunk.length === 0) {
          logger.warn(`No valid candles in chunk`);
          break;
        }

        // Store to Parquet
        const writeResult = await this.parquetWriter.appendCandles(pair, timeframe, validChunk);
        
        totalFetched += chunk.length;
        totalStored += validChunk.length;

        // Update progress
        await this.updateJobProgress(jobId, totalFetched, totalStored);

        // Update data source metadata
        await this.updateDataSource(pair, timeframe, startDate, new Date(validChunk[validChunk.length - 1].timestamp), totalStored);

        // Move to next chunk
        const lastTimestamp = validChunk[validChunk.length - 1].timestamp;
        const timeframeMs = this.parseTimeframe(timeframe);
        currentDate = new Date(lastTimestamp + timeframeMs);

        // Rate limiting
        await this.sleep(this.config.rateLimit);

        logger.info(`Progress: ${totalStored} candles stored, current: ${currentDate.toISOString()}`);
      }

      await this.updateJobStatus(jobId, 'COMPLETED', { 
        completedAt: new Date(),
        candlesFetched: totalFetched,
        candlesStored: totalStored
      });

      logger.info(`✅ Ingestion job ${jobId} completed: ${totalStored} candles stored`);

      return {
        jobId,
        status: 'completed',
        pair,
        timeframe,
        candlesFetched: totalFetched,
        candlesStored: totalStored,
        startDate,
        endDate
      };

    } catch (error) {
      logger.error(`Ingestion job ${jobId} failed:`, error);
      await this.updateJobStatus(jobId, 'FAILED', { 
        errorMessage: error.message,
        completedAt: new Date()
      });
      throw error;
    }
  }

  /**
   * Fetch a chunk of candles
   * @param {string} pair - Trading pair
   * @param {string} timeframe - Timeframe
   * @param {Date} since - Start date
   * @param {number} limit - Number of candles
   */
  async fetchChunk(pair, timeframe, since, limit) {
    const symbol = this.normalizeSymbol(pair);
    
    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        const ohlcv = await this.exchange.fetchOHLCV(symbol, timeframe, since.getTime(), limit);
        
        return ohlcv.map(candle => ({
          timestamp: candle[0],
          open: candle[1],
          high: candle[2],
          low: candle[3],
          close: candle[4],
          volume: candle[5]
        }));
      } catch (error) {
        logger.warn(`Fetch attempt ${attempt}/${this.config.maxRetries} failed:`, error.message);
        
        if (attempt < this.config.maxRetries) {
          await this.sleep(this.config.retryDelay * attempt);
        } else {
          throw error;
        }
      }
    }
    
    return [];
  }

  /**
   * Validate candles for anomalies
   * @param {Array} candles - Array of candles
   */
  validateCandles(candles) {
    return candles.filter(candle => {
      // Check for invalid values
      if (!candle.timestamp || isNaN(candle.timestamp)) return false;
      if (candle.high < candle.low) return false;
      if (candle.open <= 0 || candle.close <= 0) return false;
      if (candle.volume < 0) return false;
      
      // Check for suspicious values (price = 0, volume = 0 during trading hours)
      if (candle.close === 0) return false;
      
      return true;
    });
  }

  /**
   * Detect gaps in existing data
   * @param {string} pair - Trading pair
   * @param {string} timeframe - Timeframe
   */
  async detectGaps(pair, timeframe) {
    const dataSource = await this.getDataSource(pair, timeframe);
    
    if (!dataSource) {
      // No data at all - entire range is a gap
      return [{
        pair,
        timeframe,
        gapStart: new Date('2020-01-01'),
        gapEnd: new Date(),
        reason: 'no_data'
      }];
    }

    // Get available range from Parquet
    const range = await this.parquetWriter.getAvailableRange(pair, timeframe);
    
    if (!range) {
      return [];
    }

    const gaps = [];
    const timeframeMs = this.parseTimeframe(timeframe);
    
    // Read all candles to check for gaps
    const candles = await this.parquetWriter.readRange(
      pair, 
      timeframe, 
      range.earliest, 
      range.latest
    );

    for (let i = 1; i < candles.length; i++) {
      const prev = candles[i - 1];
      const curr = candles[i];
      const expectedDiff = timeframeMs;
      const actualDiff = curr.timestamp - prev.timestamp;

      // Gap detected if difference is more than 1.5x expected
      if (actualDiff > expectedDiff * 1.5) {
        gaps.push({
          pair,
          timeframe,
          gapStart: new Date(prev.timestamp + expectedDiff),
          gapEnd: new Date(curr.timestamp - expectedDiff),
          reason: 'missing_candles'
        });
      }
    }

    // Store gaps in database
    for (const gap of gaps) {
      await this.createDataGap(gap);
    }

    logger.info(`Detected ${gaps.length} gaps for ${pair} ${timeframe}`);
    return gaps;
  }

  /**
   * Repair detected gaps
   * @param {string} pair - Trading pair
   * @param {string} timeframe - Timeframe
   */
  async repairGaps(pair, timeframe) {
    const gaps = await this.getDataGaps(pair, timeframe, false);
    
    logger.info(`Repairing ${gaps.length} gaps for ${pair} ${timeframe}`);

    for (const gap of gaps) {
      try {
        await this.ingest(pair, timeframe, gap.gapStart, gap.gapEnd, 2); // High priority
        await this.markGapRepaired(gap.id);
      } catch (error) {
        logger.error(`Failed to repair gap ${gap.id}:`, error);
      }
    }
  }

  /**
   * Get ingestion status for all pairs/timeframes
   */
  async getStatus() {
    const prisma = database.getPrisma();
    const dataSources = await prisma.dataSource.findMany({});

    return dataSources.map(ds => ({
      pair: ds.pair,
      timeframe: ds.timeframe,
      exchange: ds.exchange,
      earliestDate: ds.earliestDate,
      latestDate: ds.latestDate,
      totalCandles: ds.totalCandles,
      fileSize: this.formatBytes(ds.fileSize),
      isComplete: ds.isComplete,
      lastUpdated: ds.lastUpdated
    }));
  }

  // Database helpers

  async createJob(jobId, pair, timeframe, startDate, endDate, priority) {
    const prisma = database.getPrisma();
    return await prisma.ingestionJob.create({
      data: {
        id: jobId,
        pair,
        timeframe,
        exchange: this.config.exchange,
        status: 'PENDING',
        priority,
        createdAt: new Date()
      }
    });
  }

  async getJob(jobId) {
    const prisma = database.getPrisma();
    return await prisma.ingestionJob.findFirst({ where: { id: jobId } });
  }

  async updateJobStatus(jobId, status, updates = {}) {
    const prisma = database.getPrisma();
    await prisma.ingestionJob.update({
      where: { id: jobId },
      data: { status, ...updates }
    });
  }

  async updateJobProgress(jobId, fetched, stored) {
    const prisma = database.getPrisma();
    await prisma.ingestionJob.update({
      where: { id: jobId },
      data: { 
        candlesFetched: fetched, 
        candlesStored: stored,
        updatedAt: new Date()
      }
    });
  }

  async updateDataSource(pair, timeframe, earliest, latest, total) {
    const prisma = database.getPrisma();
    
    // Get file info
    const fileInfo = await this.parquetWriter.getAvailableRange(pair, timeframe);
    
    await prisma.dataSource.upsert({
      where: {
        pair_timeframe_exchange: {
          pair,
          timeframe,
          exchange: this.config.exchange
        }
      },
      create: {
        pair,
        timeframe,
        exchange: this.config.exchange,
        earliestDate: earliest,
        latestDate: latest,
        totalCandles: total,
        filePath: `./data/parquet/${pair.replace('/', '-')}/${timeframe}`,
        fileSize: 0, // Calculated later
        isComplete: false,
        lastUpdated: new Date()
      },
      update: {
        latestDate: latest,
        totalCandles: total,
        lastUpdated: new Date(),
        isComplete: false
      }
    });
  }

  async getDataSource(pair, timeframe) {
    const prisma = database.getPrisma();
    return await prisma.dataSource.findUnique({
      where: {
        pair_timeframe_exchange: {
          pair,
          timeframe,
          exchange: this.config.exchange
        }
      }
    });
  }

  async createDataGap(gap) {
    const prisma = database.getPrisma();
    await prisma.dataGap.create({
      data: {
        id: `gap_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        ...gap,
        detectedAt: new Date()
      }
    });
  }

  async getDataGaps(pair, timeframe, isRepaired = false) {
    const prisma = database.getPrisma();
    return await prisma.dataGap.findMany({
      where: { pair, timeframe, isRepaired }
    });
  }

  async markGapRepaired(gapId) {
    const prisma = database.getPrisma();
    await prisma.dataGap.update({
      where: { id: gapId },
      data: { isRepaired: true, repairedAt: new Date() }
    });
  }

  // Utility functions

  normalizeSymbol(pair) {
    // Convert BTC/USD to exchange format (e.g., BTCUSDT for Binance)
    const [base, quote] = pair.split('/');
    
    if (this.config.exchange === 'binance') {
      // Binance uses BTCUSDT format
      return `${base}${quote === 'USD' ? 'USDT' : quote}`;
    }
    
    return pair;
  }

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
      throw new Error(`Invalid timeframe: ${timeframe}`);
    }

    const [, amount, unit] = match;
    return parseInt(amount) * units[unit];
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = HistoricalDataIngestor;
