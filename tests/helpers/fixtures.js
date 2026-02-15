/**
 * Test fixtures — shared mock data factories for all test files.
 */

/**
 * Create a mock OHLCV candle.
 * @param {Object} overrides
 * @returns {Object}
 */
function createMockCandle(overrides = {}) {
  const base = {
    timestamp: Date.now(),
    open: 100,
    high: 105,
    low: 95,
    close: 102,
    volume: 1000,
    pair: 'BTC/USD',
    ...overrides
  };
  return base;
}

/**
 * Create a series of mock candles with realistic price movement.
 * @param {number} count - Number of candles
 * @param {Object} options
 * @param {number} [options.startPrice=100] - Starting price
 * @param {number} [options.volatility=0.02] - Price volatility (fraction)
 * @param {number} [options.startTime] - Start timestamp (ms)
 * @param {number} [options.interval] - Interval between candles (ms)
 * @param {string} [options.pair='BTC/USD']
 * @returns {Array<Object>}
 */
function createCandleSeries(count, options = {}) {
  const {
    startPrice = 100,
    volatility = 0.02,
    startTime = Date.now() - count * 3600000,
    interval = 3600000, // 1h default
    pair = 'BTC/USD'
  } = options;

  const candles = [];
  let price = startPrice;

  for (let i = 0; i < count; i++) {
    const change = (Math.random() - 0.5) * 2 * volatility * price;
    const open = price;
    const close = price + change;
    const high = Math.max(open, close) + Math.random() * volatility * price * 0.5;
    const low = Math.min(open, close) - Math.random() * volatility * price * 0.5;
    const volume = 500 + Math.random() * 2000;

    candles.push({
      timestamp: startTime + i * interval,
      open: Math.round(open * 100) / 100,
      high: Math.round(high * 100) / 100,
      low: Math.round(low * 100) / 100,
      close: Math.round(close * 100) / 100,
      volume: Math.round(volume * 100) / 100,
      pair
    });

    price = close;
  }

  return candles;
}

/**
 * Create a mock order.
 * @param {Object} overrides
 * @returns {Object}
 */
function createMockOrder(overrides = {}) {
  return {
    id: `order-${Math.random().toString(36).substr(2, 8)}`,
    userId: 'user-1',
    exchange: 'kraken',
    pair: 'BTC/USD',
    type: 'limit',
    side: 'buy',
    amount: 0.1,
    price: 50000,
    status: 'pending',
    filledAmount: 0,
    averagePrice: 0,
    fee: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

/**
 * Create a mock position.
 * @param {Object} overrides
 * @returns {Object}
 */
function createMockPosition(overrides = {}) {
  return {
    id: `pos-${Math.random().toString(36).substr(2, 8)}`,
    userId: 'user-1',
    exchange: 'kraken',
    pair: 'BTC/USD',
    side: 'long',
    entryPrice: 50000,
    currentPrice: 51000,
    quantity: 0.1,
    status: 'open',
    unrealizedPnL: 100,
    realizedPnL: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

/**
 * Create a mock trading rule config.
 * @param {Object} overrides
 * @returns {Object}
 */
function createMockRuleConfig(overrides = {}) {
  return {
    name: 'Test Rule',
    description: 'A test trading rule',
    exchange: 'kraken',
    pair: 'BTC/USD',
    conditions: [
      {
        field: 'price',
        operator: '>',
        value: 50000
      }
    ],
    operator: 'AND',
    actions: [
      {
        type: 'send_notification',
        notification: { message: 'Price threshold reached' }
      }
    ],
    maxExecutions: 10,
    cooldownPeriod: 60000,
    ...overrides
  };
}

/**
 * Create a mock strategy config.
 * @param {Object} overrides
 * @returns {Object}
 */
function createMockStrategyConfig(overrides = {}) {
  return {
    name: 'Test Strategy',
    description: 'A test trading strategy',
    type: 'momentum',
    pair: 'BTC/USD',
    exchange: 'kraken',
    side: 'long',
    parameters: {
      fastEma: 12,
      slowEma: 26,
      signalEma: 9,
      trailingStopPercent: 3
    },
    maxPositionSize: 1.0,
    maxDailyTrades: 10,
    stopLoss: 5,
    takeProfit: 10,
    orderType: 'market',
    timeInForce: 'GTC',
    ...overrides
  };
}

/**
 * Create a mock user.
 * @param {Object} overrides
 * @returns {Object}
 */
function createMockUser(overrides = {}) {
  return {
    id: `user-${Math.random().toString(36).substr(2, 8)}`,
    email: 'test@example.com',
    name: 'Test User',
    password: '$2a$10$dummy.hashed.password',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

/**
 * Create a mock portfolio summary.
 * @param {Object} overrides
 * @returns {Object}
 */
function createMockPortfolioSummary(overrides = {}) {
  return {
    totalValue: 100000,
    cashBalance: 50000,
    positionsValue: 50000,
    positions: [
      createMockPosition()
    ],
    unrealizedPnL: 100,
    realizedPnL: 500,
    ...overrides
  };
}

/**
 * Create mock market data (as received by rule/strategy engines).
 * @param {Object} overrides
 * @returns {Object}
 */
function createMockMarketData(overrides = {}) {
  return {
    timestamp: Date.now(),
    pairs: {
      'BTC/USD': {
        price: 50000,
        bid: 49990,
        ask: 50010,
        volume: 1500,
        high: 51000,
        low: 49000,
        open: 49500,
        change24h: 1.5,
        ...overrides['BTC/USD']
      },
      'ETH/USD': {
        price: 3000,
        bid: 2995,
        ask: 3005,
        volume: 5000,
        high: 3100,
        low: 2900,
        open: 2950,
        change24h: 2.0,
        ...overrides['ETH/USD']
      }
    }
  };
}

/**
 * Create a mock WebSocket message for a given exchange.
 */
function createMockWSMessage(exchange, type = 'ticker', overrides = {}) {
  const messages = {
    kraken: {
      ticker: [0, { c: ['50000'], v: ['1500', '2000'], h: ['51000', '52000'], l: ['49000', '48000'], o: ['49500', '49000'], b: ['49990'], a: ['50010'] }, 'ticker', 'XBT/USD'],
      trade: [0, [['50000', '0.1', '1234567890.123', 'b', 'l', '']], 'trade', 'XBT/USD'],
    },
    binance: {
      ticker: { e: '24hrTicker', s: 'BTCUSD', c: '50000', o: '49500', h: '51000', l: '49000', v: '1500', q: '75000000', p: '500', P: '1.01', w: '50250', Q: '0.1', b: '49990', B: '1.5', a: '50010', A: '2.0', ...overrides },
      trade: { e: 'trade', s: 'BTCUSD', p: '50000', q: '0.1', T: Date.now(), b: 123, a: 456, t: 789, m: false, ...overrides },
    },
    coinbase: {
      ticker: { type: 'ticker', product_id: 'BTC-USD', price: '50000', volume_24h: '1500', high_24h: '51000', low_24h: '49000', open_24h: '49500', best_bid: '49990', best_ask: '50010', side: 'buy', time: new Date().toISOString(), ...overrides },
      trade: { type: 'match', product_id: 'BTC-USD', price: '50000', size: '0.1', time: new Date().toISOString(), side: 'buy', trade_id: 123, ...overrides },
    }
  };

  return messages[exchange]?.[type] || {};
}

module.exports = {
  createMockCandle,
  createCandleSeries,
  createMockOrder,
  createMockPosition,
  createMockRuleConfig,
  createMockStrategyConfig,
  createMockUser,
  createMockPortfolioSummary,
  createMockMarketData,
  createMockWSMessage
};
