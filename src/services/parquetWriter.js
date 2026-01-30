const parquet = require('parquetjs-lite');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

/**
 * ParquetWriter - Manages writing OHLCV data to compressed Parquet files
 * Organized by pair/timeframe/year-month for efficient querying
 * 
 * Note: Using UTF8 for timestamps to avoid BigInt conversion issues with Node.js v22
 * and parquetjs-lite. Timestamps are stored as ISO 8601 strings.
 */
class ParquetWriter {
  constructor(basePath = './data/parquet') {
    this.basePath = basePath;
    
    // Define Parquet schema for OHLCV data
    // Using UTF8 for timestamp to avoid BigInt issues with TIMESTAMP_MILLIS
    this.schema = new parquet.ParquetSchema({
      timestamp: { type: 'UTF8' },
      open: { type: 'DOUBLE' },
      high: { type: 'DOUBLE' },
      low: { type: 'DOUBLE' },
      close: { type: 'DOUBLE' },
      volume: { type: 'DOUBLE' }
    });
    
    // Compression options (ZSTD for best speed/compression ratio)
    this.writeOptions = {
      compression: 'ZSTD',
      rowGroupSize: 10000,
      pageSize: 8192
    };
  }

  /**
   * Convert timestamp to ISO string
   * @param {number|Date} timestamp - Unix timestamp or Date
   * @returns {string} - ISO 8601 string
   */
  toTimestampString(timestamp) {
    if (timestamp instanceof Date) {
      return timestamp.toISOString();
    }
    return new Date(timestamp).toISOString();
  }

  /**
   * Parse timestamp string to number
   * @param {string} timestampStr - ISO 8601 string
   * @returns {number} - Unix timestamp in milliseconds
   */
  parseTimestamp(timestampStr) {
    if (!timestampStr) return null;
    const date = new Date(timestampStr);
    return date.getTime();
  }

  /**
   * Initialize directory structure
   */
  async initialize() {
    try {
      await fs.mkdir(this.basePath, { recursive: true });
      logger.info(`Parquet storage initialized at ${this.basePath}`);
    } catch (error) {
      logger.error('Failed to initialize Parquet storage:', error);
      throw error;
    }
  }

  /**
   * Write candles to Parquet file
   * @param {string} pair - Trading pair (e.g., 'BTC/USD')
   * @param {string} timeframe - Timeframe (1m, 1h, 1d, etc.)
   * @param {Array} candles - Array of OHLCV candles
   * @returns {Object} - File metadata
   */
  async writeCandles(pair, timeframe, candles) {
    if (!candles || candles.length === 0) {
      throw new Error('No candles to write');
    }

    const normalizedPair = pair.replace('/', '-');
    const yearMonth = this.getYearMonth(candles[0].timestamp);
    const fileName = `${yearMonth}.parquet`;
    const dirPath = path.join(this.basePath, normalizedPair, timeframe);
    const filePath = path.join(dirPath, fileName);

    try {
      // Ensure directory exists
      await fs.mkdir(dirPath, { recursive: true });

      // Create writer
      const writer = await parquet.ParquetWriter.openFile(
        this.schema,
        filePath,
        this.writeOptions
      );

      // Write all candles with timestamp as ISO string
      for (const candle of candles) {
        await writer.appendRow({
          timestamp: this.toTimestampString(candle.timestamp),
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume
        });
      }

      await writer.close();

      // Get file stats
      const stats = await fs.stat(filePath);
      
      logger.info(`Written ${candles.length} candles to ${filePath} (${this.formatBytes(stats.size)})`);

      return {
        filePath,
        fileSize: stats.size,
        candlesWritten: candles.length,
        startDate: new Date(candles[0].timestamp),
        endDate: new Date(candles[candles.length - 1].timestamp)
      };
    } catch (error) {
      logger.error(`Failed to write Parquet file ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Append candles to existing Parquet file (or create new)
   * @param {string} pair - Trading pair
   * @param {string} timeframe - Timeframe
   * @param {Array} candles - Candles to append
   */
  async appendCandles(pair, timeframe, candles) {
    const normalizedPair = pair.replace('/', '-');
    const yearMonth = this.getYearMonth(candles[0].timestamp);
    const fileName = `${yearMonth}.parquet`;
    const dirPath = path.join(this.basePath, normalizedPair, timeframe);
    const filePath = path.join(dirPath, fileName);

    try {
      await fs.mkdir(dirPath, { recursive: true });

      // Check if file exists
      let existingCandles = [];
      try {
        await fs.access(filePath);
        // File exists, read existing data
        existingCandles = await this.readCandles(filePath);
        logger.debug(`Found ${existingCandles.length} existing candles in ${filePath}`);
      } catch {
        // File doesn't exist, will create new
      }

      // Merge and deduplicate (keep latest version if duplicates)
      const merged = [...existingCandles, ...candles];
      merged.sort((a, b) => a.timestamp - b.timestamp);
      
      // Remove duplicates (same timestamp)
      const unique = [];
      const seen = new Set();
      for (const candle of merged) {
        if (!seen.has(candle.timestamp)) {
          seen.add(candle.timestamp);
          unique.push(candle);
        }
      }

      // Rewrite file with merged data
      const writer = await parquet.ParquetWriter.openFile(
        this.schema,
        filePath,
        this.writeOptions
      );

      for (const candle of unique) {
        await writer.appendRow({
          timestamp: this.toTimestampString(candle.timestamp),
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume
        });
      }

      await writer.close();

      const stats = await fs.stat(filePath);
      const newCandles = unique.length - existingCandles.length;

      logger.info(`Updated ${filePath}: ${existingCandles.length} → ${unique.length} candles (+${newCandles})`);

      return {
        filePath,
        fileSize: stats.size,
        candlesWritten: unique.length,
        newCandles,
        startDate: new Date(unique[0].timestamp),
        endDate: new Date(unique[unique.length - 1].timestamp)
      };
    } catch (error) {
      logger.error(`Failed to append candles to ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Read candles from Parquet file
   * @param {string} filePath - Path to Parquet file
   * @returns {Array} - Array of candles
   */
  async readCandles(filePath) {
    try {
      const reader = await parquet.ParquetReader.openFile(filePath);
      const cursor = reader.getCursor();
      const candles = [];

      let record;
      while ((record = await cursor.next())) {
        // Parse timestamp string to number (handles both string and BigInt formats)
        const timestamp = this.parseTimestamp(record.timestamp);
        
        candles.push({
          timestamp,
          open: record.open,
          high: record.high,
          low: record.low,
          close: record.close,
          volume: record.volume
        });
      }

      await reader.close();
      return candles;
    } catch (error) {
      logger.error(`Failed to read Parquet file ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Read candles from multiple Parquet files
   * @param {string} pair - Trading pair
   * @param {string} timeframe - Timeframe
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Array} - Array of candles
   */
  async readRange(pair, timeframe, startDate, endDate) {
    const normalizedPair = pair.replace('/', '-');
    const dirPath = path.join(this.basePath, normalizedPair, timeframe);
    
    try {
      // Get all year-month combinations in range
      const yearMonths = this.getYearMonthsInRange(startDate, endDate);
      
      // Also check adjacent months to handle edge cases where data spans months
      const adjacentMonths = new Set(yearMonths);
      for (const ym of yearMonths) {
        const [year, month] = ym.split('-').map(Number);
        if (month > 1) {
          adjacentMonths.add(`${year}-${String(month - 1).padStart(2, '0')}`);
        } else {
          adjacentMonths.add(`${year - 1}-12`);
        }
        if (month < 12) {
          adjacentMonths.add(`${year}-${String(month + 1).padStart(2, '0')}`);
        } else {
          adjacentMonths.add(`${year + 1}-01`);
        }
      }
      
      const allYearMonths = Array.from(adjacentMonths);
      const allCandles = [];

      for (const yearMonth of allYearMonths) {
        const filePath = path.join(dirPath, `${yearMonth}.parquet`);
        
        try {
          await fs.access(filePath);
          const candles = await this.readCandles(filePath);
          
          // Filter to date range
          const filtered = candles.filter(c => 
            c.timestamp >= startDate.getTime() && 
            c.timestamp <= endDate.getTime()
          );
          
          allCandles.push(...filtered);
        } catch {
          // File doesn't exist, skip
          continue;
        }
      }

      // Sort by timestamp
      allCandles.sort((a, b) => a.timestamp - b.timestamp);

      return allCandles;
    } catch (error) {
      logger.error(`Failed to read range for ${pair} ${timeframe}:`, error);
      throw error;
    }
  }

  /**
   * Get available date range for a pair/timeframe
   * @param {string} pair - Trading pair
   * @param {string} timeframe - Timeframe
   * @returns {Object} - { earliest, latest, totalFiles }
   */
  async getAvailableRange(pair, timeframe) {
    const normalizedPair = pair.replace('/', '-');
    const dirPath = path.join(this.basePath, normalizedPair, timeframe);
    
    try {
      const files = await fs.readdir(dirPath);
      const parquetFiles = files.filter(f => f.endsWith('.parquet'));
      
      if (parquetFiles.length === 0) {
        return null;
      }

      let earliest = null;
      let latest = null;
      let totalCandles = 0;

      for (const file of parquetFiles) {
        const filePath = path.join(dirPath, file);
        const candles = await this.readCandles(filePath);
        
        if (candles.length > 0) {
          const fileEarliest = candles[0].timestamp;
          const fileLatest = candles[candles.length - 1].timestamp;
          
          if (!earliest || fileEarliest < earliest) earliest = fileEarliest;
          if (!latest || fileLatest > latest) latest = fileLatest;
          
          totalCandles += candles.length;
        }
      }

      return {
        earliest: earliest ? new Date(earliest) : null,
        latest: latest ? new Date(latest) : null,
        totalCandles,
        totalFiles: parquetFiles.length
      };
    } catch (error) {
      // Directory doesn't exist or is empty
      return null;
    }
  }

  /**
   * Get year-month string from timestamp
   * @param {number} timestamp - Unix timestamp
   * @returns {string} - Format: YYYY-MM
   */
  getYearMonth(timestamp) {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  /**
   * Get all year-month combinations in date range
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Array} - Array of YYYY-MM strings
   */
  getYearMonthsInRange(startDate, endDate) {
    const yearMonths = [];
    const current = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    const end = new Date(endDate.getFullYear(), endDate.getMonth(), 1);

    while (current <= end) {
      yearMonths.push(`${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`);
      current.setMonth(current.getMonth() + 1);
    }

    return yearMonths;
  }

  /**
   * Format bytes to human-readable string
   * @param {number} bytes - Size in bytes
   * @returns {string} - Formatted size
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Delete old files
   * @param {string} pair - Trading pair
   * @param {string} timeframe - Timeframe
   * @param {Date} before - Delete files before this date
   */
  async deleteBefore(pair, timeframe, before) {
    const normalizedPair = pair.replace('/', '-');
    const dirPath = path.join(this.basePath, normalizedPair, timeframe);
    const beforeYearMonth = this.getYearMonth(before.getTime());
    
    try {
      const files = await fs.readdir(dirPath);
      let deleted = 0;

      for (const file of files) {
        if (file.endsWith('.parquet') && file < `${beforeYearMonth}.parquet`) {
          await fs.unlink(path.join(dirPath, file));
          deleted++;
        }
      }

      logger.info(`Deleted ${deleted} old Parquet files before ${beforeYearMonth}`);
      return deleted;
    } catch (error) {
      logger.error(`Failed to delete old files:`, error);
      return 0;
    }
  }
}

module.exports = ParquetWriter;
