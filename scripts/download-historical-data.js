#!/usr/bin/env node
/**
 * Data ingestion runner - Executes ingestion jobs immediately
 * Use this to actually download historical data (not just queue jobs)
 */

const HistoricalDataIngestor = require('../src/services/historicalDataIngestor');
const database = require('../src/utils/database');
const logger = require('../src/utils/logger');

const PAIRS = ['BTC/USD', 'ETH/USD'];
const TIMEFRAMES = ['1h', '1d'];
const START_DATE = '2020-01-01';
const END_DATE = '2026-01-31';

let isShuttingDown = false;
let currentIngestor = null;

// Handle graceful shutdown
process.on('SIGINT', async () => {
  logger.info('\n⚠️  Received SIGINT, shutting down gracefully...');
  isShuttingDown = true;
  if (currentIngestor) {
    logger.info('Stopping current ingestion...');
  }
  await database.disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('\n⚠️  Received SIGTERM, shutting down gracefully...');
  isShuttingDown = true;
  await database.disconnect();
  process.exit(0);
});

async function run() {
  logger.info('=== Starting Historical Data Ingestion ===');
  logger.info(`Pairs: ${PAIRS.join(', ')}`);
  logger.info(`Timeframes: ${TIMEFRAMES.join(', ')}`);
  logger.info(`From: ${START_DATE} to ${END_DATE}`);
  logger.info('This will take 4-6 hours. Press Ctrl+C to pause (safe to resume).');
  logger.info('');

  // Initialize database
  logger.info('Connecting to database...');
  await database.connect();
  logger.info('✅ Database connected');

  const ingestor = new HistoricalDataIngestor({ exchange: 'binance' });
  currentIngestor = ingestor;
  await ingestor.initialize();

  const results = [];

  for (const pair of PAIRS) {
    for (const timeframe of TIMEFRAMES) {
      if (isShuttingDown) {
        logger.info('Shutdown requested, stopping...');
        break;
      }

      try {
        logger.info(`\n--- Starting ${pair} ${timeframe} ---`);
        
        const start = new Date(START_DATE);
        const end = new Date(END_DATE);
        
        const result = await ingestor.ingest(pair, timeframe, start, end, 2);
        
        results.push({
          pair,
          timeframe,
          status: 'success',
          candles: result.candlesStored,
          error: null
        });
        
        logger.info(`✅ Completed ${pair} ${timeframe}: ${result.candlesStored} candles`);
        
        // Small delay between jobs
        await new Promise(r => setTimeout(r, 2000));
        
      } catch (error) {
        logger.error(`❌ Failed ${pair} ${timeframe}:`, error.message);
        results.push({
          pair,
          timeframe,
          status: 'failed',
          candles: 0,
          error: error.message
        });
      }
    }
  }

  logger.info('\n=== Ingestion Complete ===');
  logger.info('Results:');
  results.forEach(r => {
    const status = r.status === 'success' ? '✅' : '❌';
    logger.info(`${status} ${r.pair} ${r.timeframe}: ${r.candles} candles${r.error ? ' - ' + r.error : ''}`);
  });

  const totalCandles = results.reduce((sum, r) => sum + r.candles, 0);
  const totalSize = results.filter(r => r.status === 'success').length;
  logger.info(`\n✅ Successfully ingested: ${totalSize}/4 datasets`);
  logger.info(`📊 Total candles stored: ${totalCandles.toLocaleString()}`);
  logger.info(`💾 Data location: ./data/parquet/`);

  // Cleanup
  await database.disconnect();
  logger.info('✅ Database disconnected');
}

run().catch(async (error) => {
  logger.error('Fatal error:', error);
  await database.disconnect().catch(() => {});
  process.exit(1);
});
