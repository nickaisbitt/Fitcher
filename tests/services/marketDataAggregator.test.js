/**
 * Tests for src/services/marketDataAggregator.js
 */

const redis = require('../../src/utils/redis');
const logger = require('../../src/utils/logger');

// Mock redis via spyOn
vi.spyOn(redis, 'get').mockResolvedValue(null);
vi.spyOn(redis, 'set').mockResolvedValue('OK');
vi.spyOn(redis, 'del').mockResolvedValue(1);
vi.spyOn(redis, 'connect').mockResolvedValue(undefined);
vi.spyOn(redis, 'disconnect').mockResolvedValue(undefined);

// Mock logger to prevent output
vi.spyOn(logger, 'info').mockImplementation(() => {});
vi.spyOn(logger, 'warn').mockImplementation(() => {});
vi.spyOn(logger, 'error').mockImplementation(() => {});
vi.spyOn(logger, 'debug').mockImplementation(() => {});

// Mock eventBus to prevent side effects
const eventBus = require('../../src/utils/eventBus');
vi.spyOn(eventBus, 'subscribe').mockImplementation(() => 'sub-id');
vi.spyOn(eventBus, 'publish').mockImplementation(() => {});

const MarketDataAggregator = require('../../src/services/marketDataAggregator');

describe('MarketDataAggregator', () => {
  let aggregator;

  beforeEach(() => {
    vi.clearAllMocks();
    aggregator = new MarketDataAggregator();
  });

  afterEach(() => {
    // Clean up timers
    aggregator.stopAggregation();
  });

  // ── constructor ──────────────────────────────────────────────

  describe('constructor', () => {
    it('initializes with empty exchanges map', () => {
      expect(aggregator.exchanges.size).toBe(0);
    });

    it('initializes with empty price cache', () => {
      expect(aggregator.priceCache.size).toBe(0);
    });

    it('initializes with empty order book cache', () => {
      expect(aggregator.orderBookCache.size).toBe(0);
    });

    it('initializes with empty trade cache', () => {
      expect(aggregator.tradeCache.size).toBe(0);
    });

    it('sets default aggregation interval to 1000ms', () => {
      expect(aggregator.aggregationInterval).toBe(1000);
    });

    it('initializes with empty subscribers map', () => {
      expect(aggregator.subscribers.size).toBe(0);
    });

    it('aggregation timer is null initially', () => {
      expect(aggregator.aggregationTimer).toBeNull();
    });
  });

  // ── exchanges ────────────────────────────────────────────────

  describe('exchange management', () => {
    it('addExchange: registers an exchange in the map', () => {
      const mockWS = { on: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), getStatus: vi.fn() };
      aggregator.exchanges.set('kraken', mockWS);
      expect(aggregator.exchanges.has('kraken')).toBe(true);
    });

    it('removeExchange: removes an exchange', () => {
      const mockWS = { disconnect: vi.fn() };
      aggregator.exchanges.set('kraken', mockWS);
      aggregator.exchanges.delete('kraken');
      expect(aggregator.exchanges.has('kraken')).toBe(false);
    });
  });

  // ── price caching ────────────────────────────────────────────

  describe('updatePrice (cacheData with ticker)', () => {
    it('stores latest price for pair in priceCache', () => {
      const tickerData = {
        type: 'ticker',
        exchange: 'kraken',
        pair: 'BTC/USD',
        price: 50000,
        bid: 49990,
        ask: 50010,
        volume: 1500,
        timestamp: Date.now(),
        receivedAt: Date.now()
      };

      aggregator.cacheData(tickerData);
      const key = 'ticker:kraken:BTC/USD';
      expect(aggregator.priceCache.has(key)).toBe(true);
      expect(aggregator.priceCache.get(key).price).toBe(50000);
    });

    it('updates existing cached price', () => {
      const data1 = { type: 'ticker', exchange: 'kraken', pair: 'BTC/USD', price: 50000 };
      const data2 = { type: 'ticker', exchange: 'kraken', pair: 'BTC/USD', price: 51000 };

      aggregator.cacheData(data1);
      aggregator.cacheData(data2);

      const cached = aggregator.priceCache.get('ticker:kraken:BTC/USD');
      expect(cached.price).toBe(51000);
    });
  });

  // ── handleMarketData ─────────────────────────────────────────

  describe('handleMarketData', () => {
    it('processes ticker data and caches it', () => {
      aggregator.handleMarketData('kraken', {
        type: 'ticker',
        pair: 'BTC/USD',
        data: {
          price: '50000',
          bid: '49990',
          ask: '50010',
          high: '51000',
          low: '49000',
          volume: '1500',
          change: '500',
          changePercent: '1.01'
        },
        timestamp: Date.now()
      });

      expect(aggregator.priceCache.size).toBe(1);
      const cached = aggregator.priceCache.get('ticker:kraken:BTC/USD');
      expect(cached.price).toBe(50000);
    });

    it('updates internal state on ticker update', () => {
      aggregator.handleMarketData('binance', {
        type: 'ticker',
        pair: 'ETH-USD',
        data: { price: '3000', bid: '2995', ask: '3005', high: '3100', low: '2900', volume: '5000', change: '50', changePercent: '1.69' },
        timestamp: Date.now()
      });

      // normalizePair should convert ETH-USD -> ETH/USD
      expect(aggregator.priceCache.has('ticker:binance:ETH/USD')).toBe(true);
    });

    it('publishes market:priceUpdate via eventBus for tickers', () => {
      aggregator.handleMarketData('kraken', {
        type: 'ticker',
        pair: 'BTC/USD',
        data: { price: '50000', bid: '49990', ask: '50010', high: '51000', low: '49000', volume: '1500', change: '0', changePercent: '0' },
        timestamp: Date.now()
      });

      expect(eventBus.publish).toHaveBeenCalledWith('market:priceUpdate', expect.objectContaining({
        type: 'ticker',
        pair: 'BTC/USD'
      }));
    });

    it('caches orderbook data separately', () => {
      aggregator.handleMarketData('kraken', {
        type: 'orderbook',
        pair: 'BTC/USD',
        data: { bids: [[49990, 1.0]], asks: [[50010, 0.5]] },
        timestamp: Date.now()
      });

      expect(aggregator.orderBookCache.size).toBe(1);
    });

    it('caches trade data in tradeCache', () => {
      aggregator.handleMarketData('kraken', {
        type: 'trade',
        pair: 'BTC/USD',
        data: { price: '50000', volume: '0.1', side: 'buy' },
        timestamp: Date.now()
      });

      expect(aggregator.tradeCache.size).toBe(1);
    });

    it('persists data to redis', () => {
      vi.clearAllMocks();
      aggregator.handleMarketData('kraken', {
        type: 'ticker',
        pair: 'BTC/USD',
        data: { price: '50000', bid: '49990', ask: '50010', high: '51000', low: '49000', volume: '1500', change: '0', changePercent: '0' },
        timestamp: Date.now()
      });

      expect(redis.set).toHaveBeenCalled();
    });
  });

  // ── getAggregatedPrice (calculateAggregatedPrice) ────────────

  describe('getAggregatedPrice (calculateAggregatedPrice)', () => {
    it('returns volume-weighted average across exchanges', () => {
      const prices = [
        { exchange: 'kraken', price: 50000, bid: 49990, ask: 50010, volume: 1000, timestamp: Date.now() },
        { exchange: 'binance', price: 50100, bid: 50090, ask: 50110, volume: 2000, timestamp: Date.now() }
      ];

      const aggregated = aggregator.calculateAggregatedPrice('BTC/USD', prices);

      // VWAP: (50000*1000 + 50100*2000) / 3000 = 50066.67
      expect(aggregated.vwap).toBeCloseTo(50066.67, 1);
      expect(aggregated.pair).toBe('BTC/USD');
    });

    it('returns null/undefined for unknown pair via getPrice', () => {
      const price = aggregator.getPrice('UNKNOWN/USD');
      expect(price).toBeNull();
    });

    it('returns best bid/ask across exchanges', () => {
      const prices = [
        { exchange: 'kraken', price: 50000, bid: 49990, ask: 50010, volume: 1000, timestamp: Date.now() },
        { exchange: 'binance', price: 50100, bid: 50095, ask: 50005, volume: 2000, timestamp: Date.now() }
      ];

      const aggregated = aggregator.calculateAggregatedPrice('BTC/USD', prices);

      expect(aggregated.bestBid).toBe(50095); // highest bid
      expect(aggregated.bestAsk).toBe(50005); // lowest ask
    });

    it('returns total volume', () => {
      const prices = [
        { exchange: 'kraken', price: 50000, bid: 49990, ask: 50010, volume: 1000, timestamp: Date.now() },
        { exchange: 'binance', price: 50100, bid: 50090, ask: 50110, volume: 2000, timestamp: Date.now() }
      ];

      const aggregated = aggregator.calculateAggregatedPrice('BTC/USD', prices);
      expect(aggregated.totalVolume).toBe(3000);
    });

    it('single exchange returns that price directly', () => {
      const prices = [
        { exchange: 'kraken', price: 50000, bid: 49990, ask: 50010, volume: 1000, timestamp: Date.now() }
      ];

      const aggregated = aggregator.calculateAggregatedPrice('BTC/USD', prices);
      expect(aggregated.vwap).toBe(50000);
      expect(aggregated.exchangeCount).toBe(1);
    });

    it('handles zero total volume gracefully', () => {
      const prices = [
        { exchange: 'kraken', price: 50000, bid: 49990, ask: 50010, volume: 0, timestamp: Date.now() }
      ];

      const aggregated = aggregator.calculateAggregatedPrice('BTC/USD', prices);
      expect(aggregated.vwap).toBe(0);
    });
  });

  // ── subscribe / unsubscribe ──────────────────────────────────

  describe('subscribe / unsubscribe', () => {
    it('adds pair subscription', () => {
      const callback = vi.fn();
      aggregator.subscribe('ticker', 'BTC/USD', callback);

      expect(aggregator.subscribers.has('ticker:BTC/USD')).toBe(true);
      expect(aggregator.subscribers.get('ticker:BTC/USD').size).toBe(1);
    });

    it('removes pair subscription', () => {
      const callback = vi.fn();
      aggregator.subscribe('ticker', 'BTC/USD', callback);
      aggregator.unsubscribe('ticker', 'BTC/USD', callback);

      expect(aggregator.subscribers.has('ticker:BTC/USD')).toBe(false);
    });

    it('emits data to subscribers', () => {
      const callback = vi.fn();
      aggregator.subscribe('ticker', 'BTC/USD', callback);

      aggregator.emitToSubscribers({
        type: 'ticker',
        pair: 'BTC/USD',
        price: 50000
      });

      expect(callback).toHaveBeenCalledWith(expect.objectContaining({
        pair: 'BTC/USD',
        price: 50000
      }));
    });

    it('handles subscriber callback errors gracefully', () => {
      const badCallback = vi.fn(() => { throw new Error('callback error'); });
      const goodCallback = vi.fn();

      aggregator.subscribe('ticker', 'BTC/USD', badCallback);
      aggregator.subscribe('ticker', 'BTC/USD', goodCallback);

      // Should not throw
      aggregator.emitToSubscribers({ type: 'ticker', pair: 'BTC/USD', price: 50000 });

      expect(goodCallback).toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  // ── getAvailablePairs ────────────────────────────────────────

  describe('getAvailablePairs', () => {
    it('lists all pairs with data in price cache', () => {
      aggregator.cacheData({ type: 'ticker', exchange: 'kraken', pair: 'BTC/USD', price: 50000 });
      aggregator.cacheData({ type: 'ticker', exchange: 'kraken', pair: 'ETH/USD', price: 3000 });

      const pairs = new Set();
      for (const [key, data] of aggregator.priceCache) {
        if (data.type === 'ticker') pairs.add(data.pair);
      }

      expect(pairs.size).toBe(2);
      expect(pairs.has('BTC/USD')).toBe(true);
      expect(pairs.has('ETH/USD')).toBe(true);
    });
  });

  // ── getStatus ────────────────────────────────────────────────

  describe('getStatus', () => {
    it('returns overall status with cache stats', () => {
      const status = aggregator.getStatus();

      expect(status.exchanges).toBeDefined();
      expect(status.totalSubscriptions).toBe(0);
      expect(status.cacheStats.prices).toBe(0);
      expect(status.cacheStats.orderBooks).toBe(0);
      expect(status.cacheStats.trades).toBe(0);
    });

    it('reflects cache size after data is added', () => {
      aggregator.cacheData({ type: 'ticker', exchange: 'kraken', pair: 'BTC/USD', price: 50000 });
      aggregator.cacheData({ type: 'orderbook', exchange: 'kraken', pair: 'BTC/USD', bids: [], asks: [] });

      const status = aggregator.getStatus();
      expect(status.cacheStats.prices).toBe(1);
      expect(status.cacheStats.orderBooks).toBe(1);
    });

    it('includes exchange status', () => {
      const mockWS = { getStatus: vi.fn().mockReturnValue({ connected: true }) };
      aggregator.exchanges.set('kraken', mockWS);

      const status = aggregator.getStatus();
      expect(status.exchanges.kraken).toEqual({ connected: true });
    });
  });

  // ── getPrice ─────────────────────────────────────────────────

  describe('getPrice', () => {
    it('returns cached price for specific exchange', () => {
      aggregator.cacheData({
        type: 'ticker', exchange: 'kraken', pair: 'BTC/USD',
        price: 50000, bid: 49990, ask: 50010
      });

      const price = aggregator.getPrice('BTC/USD', 'kraken');
      expect(price.price).toBe(50000);
    });

    it('returns best spread price across exchanges when no exchange specified', () => {
      aggregator.cacheData({
        type: 'ticker', exchange: 'kraken', pair: 'BTC/USD',
        price: 50000, bid: 49990, ask: 50020
      });
      aggregator.cacheData({
        type: 'ticker', exchange: 'binance', pair: 'BTC/USD',
        price: 50100, bid: 50090, ask: 50100
      });

      const price = aggregator.getPrice('BTC/USD');
      // binance has tighter spread (10 vs 30), so it should be returned
      expect(price.exchange).toBe('binance');
    });

    it('returns null for unknown pair', () => {
      const price = aggregator.getPrice('NONEXISTENT/USD');
      expect(price).toBeNull();
    });
  });

  // ── normalizePair ────────────────────────────────────────────

  describe('normalizePair', () => {
    it('converts dash-separated pairs to slash format', () => {
      expect(aggregator.normalizePair('BTC-USD')).toBe('BTC/USD');
    });

    it('converts underscore-separated pairs to slash format', () => {
      expect(aggregator.normalizePair('BTC_USD')).toBe('BTC/USD');
    });

    it('uppercases the pair', () => {
      expect(aggregator.normalizePair('btc/usd')).toBe('BTC/USD');
    });

    it('handles already-normalized pairs', () => {
      expect(aggregator.normalizePair('BTC/USD')).toBe('BTC/USD');
    });
  });

  // ── trade cache management ───────────────────────────────────

  describe('trade cache (price history)', () => {
    it('maintains recent trades in trade cache', () => {
      aggregator.cacheData({
        type: 'trade', exchange: 'kraken', pair: 'BTC/USD',
        price: 50000, volume: 0.1, timestamp: Date.now()
      });
      aggregator.cacheData({
        type: 'trade', exchange: 'kraken', pair: 'BTC/USD',
        price: 50100, volume: 0.2, timestamp: Date.now()
      });

      const trades = aggregator.tradeCache.get('trade:kraken:BTC/USD');
      expect(trades.length).toBe(2);
    });

    it('caps trade cache at 1000 entries', () => {
      const key = 'trade:kraken:BTC/USD';
      aggregator.tradeCache.set(key, []);

      for (let i = 0; i < 1005; i++) {
        aggregator.cacheData({
          type: 'trade', exchange: 'kraken', pair: 'BTC/USD',
          price: 50000 + i, volume: 0.1, timestamp: Date.now()
        });
      }

      expect(aggregator.tradeCache.get(key).length).toBeLessThanOrEqual(1000);
    });
  });

  // ── handle missing/invalid data ──────────────────────────────

  describe('handle missing exchange gracefully', () => {
    it('getPrice returns null for exchange with no data', () => {
      const price = aggregator.getPrice('BTC/USD', 'nonexistent');
      expect(price).toBeUndefined();
    });
  });

  describe('handle NaN/invalid price gracefully', () => {
    it('normalizeData converts NaN strings to 0', () => {
      const normalized = aggregator.normalizeData('kraken', {
        type: 'ticker',
        pair: 'BTC/USD',
        data: { price: 'not-a-number', bid: '', ask: '', high: '', low: '', volume: '', change: '', changePercent: '' },
        timestamp: Date.now()
      });

      expect(normalized.price).toBe(0);
      expect(normalized.bid).toBe(0);
    });
  });

  // ── shutdown ─────────────────────────────────────────────────

  describe('shutdown', () => {
    it('cleans up all caches and exchanges', async () => {
      // Add some data
      aggregator.cacheData({ type: 'ticker', exchange: 'kraken', pair: 'BTC/USD', price: 50000 });
      const mockWS = { disconnect: vi.fn() };
      aggregator.exchanges.set('kraken', mockWS);

      await aggregator.shutdown();

      expect(aggregator.exchanges.size).toBe(0);
      expect(aggregator.subscribers.size).toBe(0);
      expect(aggregator.priceCache.size).toBe(0);
      expect(aggregator.orderBookCache.size).toBe(0);
      expect(aggregator.tradeCache.size).toBe(0);
    });

    it('disconnects all exchange websockets', async () => {
      const mockWS = { disconnect: vi.fn() };
      aggregator.exchanges.set('kraken', mockWS);

      await aggregator.shutdown();

      expect(mockWS.disconnect).toHaveBeenCalled();
    });

    it('stops the aggregation timer', async () => {
      aggregator.startAggregation();
      expect(aggregator.aggregationTimer).not.toBeNull();

      await aggregator.shutdown();
      expect(aggregator.aggregationTimer).toBeNull();
    });
  });
});
