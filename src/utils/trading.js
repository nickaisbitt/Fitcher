/**
 * Shared trading utilities — deduplicates common functions from
 * historicalDataService.js and historicalDataIngestor.js
 */

/**
 * Parse a timeframe string (e.g., '1h', '5m', '1d') into milliseconds.
 * @param {string} timeframe
 * @returns {number} Duration in milliseconds
 */
function parseTimeframe(timeframe) {
  if (!timeframe || typeof timeframe !== 'string') {
    throw new Error(`Invalid timeframe: ${timeframe}`);
  }

  const units = {
    's': 1000,
    'm': 60 * 1000,
    'h': 60 * 60 * 1000,
    'd': 24 * 60 * 60 * 1000,
    'w': 7 * 24 * 60 * 60 * 1000,
    'M': 30 * 24 * 60 * 60 * 1000
  };

  const match = timeframe.match(/^(\d+)([smhdwM])$/);
  if (!match) {
    throw new Error(`Invalid timeframe format: ${timeframe}. Expected format: <number><unit> (e.g., 1h, 5m, 1d)`);
  }

  const [, amount, unit] = match;
  return parseInt(amount, 10) * units[unit];
}

/**
 * Normalize a trading pair symbol to a canonical format (BASE/QUOTE uppercase).
 * Handles common exchange-specific formats:
 *   BTC-USD  -> BTC/USD
 *   btcusd   -> BTC/USD
 *   BTC/USD  -> BTC/USD (no-op)
 *   XBTUSD   -> XBT/USD (3+3 split)
 *
 * @param {string} symbol
 * @returns {string} Normalized symbol (e.g., 'BTC/USD')
 */
function normalizeSymbol(symbol) {
  if (!symbol || typeof symbol !== 'string') {
    throw new Error(`Invalid symbol: ${symbol}`);
  }

  let normalized = symbol.trim().toUpperCase();

  // Already in BASE/QUOTE format
  if (normalized.includes('/')) {
    return normalized;
  }

  // BASE-QUOTE format
  if (normalized.includes('-')) {
    return normalized.replace('-', '/');
  }

  // Concatenated format: try common quote currencies
  const quoteCurrencies = ['USDT', 'USDC', 'USD', 'EUR', 'GBP', 'BTC', 'ETH'];
  for (const quote of quoteCurrencies) {
    if (normalized.endsWith(quote) && normalized.length > quote.length) {
      const base = normalized.slice(0, -quote.length);
      return `${base}/${quote}`;
    }
  }

  // Fallback: split in half if even length, or 3+remaining
  if (normalized.length >= 6) {
    const mid = Math.floor(normalized.length / 2);
    return `${normalized.slice(0, mid)}/${normalized.slice(mid)}`;
  }

  return normalized;
}

/**
 * Sleep for a given duration.
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Validate an OHLCV candle object has all required fields with valid values.
 * @param {Object} candle
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateCandle(candle) {
  const errors = [];

  if (!candle || typeof candle !== 'object') {
    return { valid: false, errors: ['Candle must be an object'] };
  }

  const requiredFields = ['timestamp', 'open', 'high', 'low', 'close', 'volume'];
  for (const field of requiredFields) {
    if (candle[field] === undefined || candle[field] === null) {
      errors.push(`Missing required field: ${field}`);
    } else if (field !== 'timestamp' && (typeof candle[field] !== 'number' || isNaN(candle[field]))) {
      errors.push(`${field} must be a valid number, got: ${candle[field]}`);
    }
  }

  if (errors.length === 0) {
    if (candle.high < candle.low) {
      errors.push(`high (${candle.high}) must be >= low (${candle.low})`);
    }
    if (candle.high < candle.open || candle.high < candle.close) {
      errors.push(`high (${candle.high}) must be >= open and close`);
    }
    if (candle.low > candle.open || candle.low > candle.close) {
      errors.push(`low (${candle.low}) must be <= open and close`);
    }
    if (candle.volume < 0) {
      errors.push(`volume must be >= 0`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Normalize raw exchange OHLCV data (array or object format) to standard candle objects.
 * Uses nullish coalescing (??) to correctly handle zero values.
 * @param {Array} rawData - Array of candles (can be arrays or objects)
 * @returns {Array<Object>} Normalized candles
 */
function normalizeOHLCV(rawData) {
  if (!Array.isArray(rawData)) return [];

  return rawData.map(candle => {
    if (Array.isArray(candle)) {
      return {
        timestamp: candle[0],
        open: candle[1],
        high: candle[2],
        low: candle[3],
        close: candle[4],
        volume: candle[5]
      };
    }
    return {
      timestamp: candle.timestamp ?? candle[0],
      open: candle.open ?? candle[1],
      high: candle.high ?? candle[2],
      low: candle.low ?? candle[3],
      close: candle.close ?? candle[4],
      volume: candle.volume ?? candle[5]
    };
  });
}

module.exports = {
  parseTimeframe,
  normalizeSymbol,
  sleep,
  validateCandle,
  normalizeOHLCV
};
