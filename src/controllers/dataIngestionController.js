const HistoricalDataIngestor = require('../services/historicalDataIngestor');
const ParquetWriter = require('../services/parquetWriter');
const database = require('../utils/database');
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

class DataIngestionController {
  constructor() {
    this.ingestor = new HistoricalDataIngestor({ exchange: 'binance' });
    this.parquetWriter = new ParquetWriter();
    this.initialized = false;
  }

  async ensureInitialized() {
    if (!this.initialized) {
      await this.ingestor.initialize();
      this.initialized = true;
    }
  }

  /**
   * POST /api/data/ingest
   * Trigger data ingestion for specified pairs/timeframes
   */
  ingest = asyncHandler(async (req, res) => {
    await this.ensureInitialized();

    const {
      pairs = ['BTC/USD', 'ETH/USD'],
      timeframes = ['1h', '1d'],
      startDate = '2020-01-01',
      endDate = new Date().toISOString(),
      priority = 1,
      async = true
    } = req.body || {};

    const start = new Date(startDate);
    const end = new Date(endDate);

    logger.info(`Data ingestion requested`, {
      userId: req.user?.userId,
      pairs,
      timeframes,
      startDate: start,
      endDate: end
    });

    if (async) {
      // Start background job
      const jobs = [];
      for (const pair of pairs) {
        for (const timeframe of timeframes) {
          // Create job record
          const job = await this.createIngestionJob(pair, timeframe, start, end, priority);
          jobs.push({
            jobId: job.id,
            pair,
            timeframe,
            status: 'PENDING'
          });
        }
      }

      // Start ingestion in background (don't await)
      this.runBackgroundIngestion(jobs);

      res.status(202).json({
        success: true,
        message: 'Ingestion jobs queued',
        data: {
          jobsQueued: jobs.length,
          jobs
        }
      });
    } else {
      // Synchronous ingestion
      const results = [];
      for (const pair of pairs) {
        for (const timeframe of timeframes) {
          const result = await this.ingestor.ingest(pair, timeframe, start, end, priority);
          results.push(result);
        }
      }

      res.json({
        success: true,
        data: {
          results,
          totalCandles: results.reduce((sum, r) => sum + r.candlesStored, 0)
        }
      });
    }
  });

  /**
   * GET /api/data/status
   * Get status of all data sources
   */
  status = asyncHandler(async (req, res) => {
    const prisma = database.getPrisma();
    const dataSources = await prisma.dataSource.findMany({
      orderBy: { lastUpdated: 'desc' }
    });

    const jobs = await prisma.ingestionJob.findMany({
      where: { status: { in: ['PENDING', 'RUNNING'] } },
      orderBy: { createdAt: 'desc' },
      take: 10
    });

    res.json({
      success: true,
      data: {
        sources: dataSources.map(ds => ({
          pair: ds.pair,
          timeframe: ds.timeframe,
          exchange: ds.exchange,
          range: {
            earliest: ds.earliestDate,
            latest: ds.latestDate
          },
          totalCandles: ds.totalCandles,
          isComplete: ds.isComplete,
          lastUpdated: ds.lastUpdated
        })),
        activeJobs: jobs.map(job => ({
          jobId: job.id,
          pair: job.pair,
          timeframe: job.timeframe,
          status: job.status,
          progress: {
            fetched: job.candlesFetched,
            stored: job.candlesStored
          },
          startedAt: job.startedAt
        }))
      }
    });
  });

  /**
   * GET /api/data/gaps
   * Detect and report data gaps
   */
  gaps = asyncHandler(async (req, res) => {
    await this.ensureInitialized();

    const { pair = 'BTC/USD', timeframe = '1h' } = req.query;

    const gaps = await this.ingestor.detectGaps(pair, timeframe);

    res.json({
      success: true,
      data: {
        pair,
        timeframe,
        gapsFound: gaps.length,
        gaps: gaps.map(gap => ({
          gapStart: gap.gapStart,
          gapEnd: gap.gapEnd,
          duration: Math.round((gap.gapEnd - gap.gapStart) / (1000 * 60 * 60)) + ' hours',
          reason: gap.reason
        }))
      }
    });
  });

  /**
   * POST /api/data/repair
   * Repair detected gaps
   */
  repair = asyncHandler(async (req, res) => {
    await this.ensureInitialized();

    const { pair = 'BTC/USD', timeframe = '1h' } = req.body || {};

    // Run repair in background
    this.ingestor.repairGaps(pair, timeframe).catch(error => {
      logger.error(`Gap repair failed for ${pair} ${timeframe}:`, error);
    });

    res.status(202).json({
      success: true,
      message: 'Gap repair started',
      data: { pair, timeframe }
    });
  });

  /**
   * GET /api/data/read
   * Read historical data from local storage
   */
  read = asyncHandler(async (req, res) => {
    const {
      pair = 'BTC/USD',
      timeframe = '1h',
      from,
      to,
      limit = 1000
    } = req.query;

    if (!from || !to) {
      return res.status(400).json({
        success: false,
        error: 'from and to dates are required',
        code: 'MISSING_PARAMS'
      });
    }

    const startDate = new Date(from);
    const endDate = new Date(to);
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 1000, 1), 10000);

    const candles = await this.parquetWriter.readRange(pair, timeframe, startDate, endDate);

    // Apply limit
    const limited = candles.slice(0, safeLimit);

    res.json({
      success: true,
      data: {
        pair,
        timeframe,
        range: { from: startDate, to: endDate },
        totalAvailable: candles.length,
        returned: limited.length,
        candles: limited
      }
    });
  });

  /**
   * POST /api/data/prefetch
   * Pre-fetch common datasets (BTC/USD 1h, 1d from 2020)
   */
  prefetch = asyncHandler(async (req, res) => {
    await this.ensureInitialized();

    const pairs = ['BTC/USD', 'ETH/USD'];
    const timeframes = ['1h', '1d'];
    const startDate = new Date('2020-01-01');
    const endDate = new Date();

    const jobs = [];
    for (const pair of pairs) {
      for (const timeframe of timeframes) {
        const job = await this.createIngestionJob(pair, timeframe, startDate, endDate, 2);
        jobs.push({
          jobId: job.id,
          pair,
          timeframe,
          status: 'PENDING'
        });
      }
    }

    // Start background ingestion
    this.runBackgroundIngestion(jobs);

    res.status(202).json({
      success: true,
      message: 'Pre-fetch jobs queued for BTC/USD and ETH/USD (2020-present)',
      data: {
        pairs,
        timeframes,
        startDate,
        endDate,
        jobsQueued: jobs.length,
        jobs,
        estimatedTime: '4-6 hours for full download'
      }
    });
  });

  // Helper methods

  async createIngestionJob(pair, timeframe, startDate, endDate, priority) {
    const prisma = database.getPrisma();
    return await prisma.ingestionJob.create({
      data: {
        id: `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        pair,
        timeframe,
        exchange: 'binance',
        status: 'PENDING',
        priority,
        createdAt: new Date()
      }
    });
  }

  async runBackgroundIngestion(jobs) {
    for (const jobInfo of jobs) {
      try {
        const job = await database.getPrisma().ingestionJob.findFirst({
          where: { id: jobInfo.jobId }
        });

        if (!job) continue;

        const result = await this.ingestor.ingest(
          job.pair,
          job.timeframe,
          new Date(job.createdAt), // Use job creation as proxy for start
          new Date(),
          job.priority
        );

        logger.info(`Background job ${jobInfo.jobId} completed:`, result);
      } catch (error) {
        logger.error(`Background job ${jobInfo.jobId} failed:`, error);
      }
    }
  }
}

module.exports = new DataIngestionController();
