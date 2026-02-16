#!/usr/bin/env node
/**
 * download-backtest-data.js
 * Downloads historical data to local JSON files for backtesting
 * Stores in data/historical/ directory
 */

const ccxt = require('ccxt');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../src/utils/logger');

// Configuration
const CONFIG = {
  exchange: 'binance',
  pairs: ['BTC/USDT', 'ETH/USDT'],
  timeframes: ['15m', '1h', '4h', '1d'],
  startDate: '2019-01-01', // 5 years
  endDate: new Date().toISOString().split('T')[0],
  batchSize: 1000,
  requestDelay: 200,
  outputDir: path.join(__dirname, '..', 'data', 'historical')
};

async function ensureOutputDir() {
  await fs.mkdir(CONFIG.outputDir, { recursive: true });
}

function timeframeToMs(timeframe) {
  const units = { 'm': 60 * 1000, 'h': 60 * 60 * 1000, 'd': 24 * 60 * 60 * 1000 };
  const value = parseInt(timeframe);
  const unit = timeframe.slice(-1);
  return value * (units[unit] || 60000);
}

async function downloadOHLCV(exchange, pair, timeframe, startTime, endTime) {
  const allCandles = [];
  let currentSince = startTime;
  const timeframeMs = timeframeToMs(timeframe);
  
  logger.info(`Downloading ${pair} ${timeframe}...`);
  
  while (currentSince < endTime) {
    try {
      const candles = await exchange.fetchOHLCV(pair, timeframe, currentSince, CONFIG.batchSize);
      
      if (!candles || candles.length === 0) break;
      
      allCandles.push(...candles);
      const lastCandle = candles[candles.length - 1];
      currentSince = lastCandle[0] + timeframeMs;
      
      if (allCandles.length % 5000 === 0) {
        const progress = ((currentSince - startTime) / (endTime - startTime)) * 100;
        logger.info(`  Progress: ${allCandles.length} candles (${progress.toFixed(1)}%)`);
      }
      
      await new Promise(r => setTimeout(r, CONFIG.requestDelay));
      
      if (candles.length < CONFIG.batchSize) break;
      
    } catch (error) {
      logger.error(`  Error: ${error.message}`);
      if (error.message.includes('rate limit')) {
        await new Promise(r => setTimeout(r, 10000));
      } else {
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }
  
  logger.info(`  Complete: ${allCandles.length} candles`);
  return allCandles;
}

async function saveCandles(pair, timeframe, candles) {
  const safePair = pair.replace('/', '_');
  const filename = `${safePair}_${timeframe}.json`;
  const filepath = path.join(CONFIG.outputDir, filename);
  
  const data = candles.map(c => ({
    timestamp: c[0],
    datetime: new Date(c[0]).toISOString(),
    open: c[1],
    high: c[2],
    low: c[3],
    close: c[4],
    volume: c[5]
  }));
  
  await fs.writeFile(filepath, JSON.stringify(data));
  logger.info(`  Saved: ${filename}`);
  return filepath;
}

async function main() {
  logger.info('=== Backtest Data Download ===');
  logger.info(`Output: ${CONFIG.outputDir}`);
  
  await ensureOutputDir();
  
  const exchange = new ccxt[CONFIG.exchange]({ enableRateLimit: true });
  await exchange.loadMarkets();
  
  const startTime = new Date(CONFIG.startDate).getTime();
  const endTime = new Date(CONFIG.endDate).getTime();
  
  const downloads = [];
  
  for (const pair of CONFIG.pairs) {
    for (const timeframe of CONFIG.timeframes) {
      try {
        const candles = await downloadOHLCV(exchange, pair, timeframe, startTime, endTime);
        if (candles.length > 0) {
          const filepath = await saveCandles(pair, timeframe, candles);
          downloads.push({ pair, timeframe, candles: candles.length, filepath });
        }
        await new Promise(r => setTimeout(r, 1000));
      } catch (error) {
        logger.error(`Failed ${pair} ${timeframe}:`, error.message);
      }
    }
  }
  
  // Save metadata
  const metadata = {
    generatedAt: new Date().toISOString(),
    exchange: CONFIG.exchange,
    downloads,
    totalCandles: downloads.reduce((sum, d) => sum + d.candles, 0)
  };
  await fs.writeFile(
    path.join(CONFIG.outputDir, 'metadata.json'),
    JSON.stringify(metadata, null, 2)
  );
  
  logger.info('\n=== Complete ===');
  logger.info(`Files: ${downloads.length}`);
  logger.info(`Total candles: ${metadata.totalCandles}`);
}

if (require.main === module) {
  main().catch(error => {
    logger.error('Failed:', error);
    process.exit(1);
  });
}

module.exports = { downloadOHLCV, CONFIG };
