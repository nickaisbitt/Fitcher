// vitest globals (describe, it, expect) are injected via vitest.config.js globals: true
const MarketDataWebSocket = require('../../src/services/marketDataWebSocket');
const { createMockWSMessage } = require('../helpers/fixtures');

describe('MarketDataWebSocket', () => {
  let ws;

  beforeEach(() => {
    ws = new MarketDataWebSocket('kraken');
  });

  // ── constructor ──────────────────────────────────────────────

  describe('constructor', () => {
    it('sets defaults', () => {
      expect(ws.exchangeName).toBe('kraken');
      expect(ws.isConnected).toBe(false);
      expect(ws.reconnectAttempts).toBe(0);
      expect(ws.maxReconnectAttempts).toBe(5);
      expect(ws.reconnectDelay).toBe(1000);
      expect(ws.heartbeatInterval).toBe(30000);
      expect(ws.subscriptions).toBeInstanceOf(Map);
      expect(ws.subscriptions.size).toBe(0);
    });

    it('respects config overrides', () => {
      const custom = new MarketDataWebSocket('binance', {
        maxReconnectAttempts: 10,
        reconnectDelay: 2000,
        heartbeatInterval: 15000
      });

      expect(custom.exchangeName).toBe('binance');
      expect(custom.maxReconnectAttempts).toBe(10);
      expect(custom.reconnectDelay).toBe(2000);
      expect(custom.heartbeatInterval).toBe(15000);
    });
  });

  // ── getWebSocketUrl ──────────────────────────────────────────

  describe('getWebSocketUrl', () => {
    it('returns correct URL for kraken', () => {
      const kws = new MarketDataWebSocket('kraken');
      expect(kws.getWebSocketUrl()).toBe('wss://ws.kraken.com/');
    });

    it('returns correct URL for binance', () => {
      const bws = new MarketDataWebSocket('binance');
      expect(bws.getWebSocketUrl()).toBe('wss://stream.binance.com:9443/ws');
    });

    it('returns correct URL for coinbase', () => {
      const cws = new MarketDataWebSocket('coinbase');
      expect(cws.getWebSocketUrl()).toBe('wss://ws-feed.exchange.coinbase.com');
    });

    it('defaults to kraken for unknown exchange', () => {
      const uws = new MarketDataWebSocket('unknownExchange');
      expect(uws.getWebSocketUrl()).toBe('wss://ws.kraken.com/');
    });
  });

  // ── subscribe ────────────────────────────────────────────────

  describe('subscribe', () => {
    it('stores subscription in map', () => {
      ws.subscribe('ticker', 'XBT/USD');

      expect(ws.subscriptions.has('ticker:XBT/USD')).toBe(true);
      const sub = ws.subscriptions.get('ticker:XBT/USD');
      expect(sub.channel).toBe('ticker');
      expect(sub.pair).toBe('XBT/USD');
    });

    it('sends message when connected', () => {
      ws.isConnected = true;
      ws.ws = { send: vi.fn() };

      ws.subscribe('ticker', 'XBT/USD');

      expect(ws.ws.send).toHaveBeenCalledTimes(1);
      const sent = JSON.parse(ws.ws.send.mock.calls[0][0]);
      expect(sent.event).toBe('subscribe');
    });

    it('skips duplicate subscription', () => {
      ws.isConnected = true;
      ws.ws = { send: vi.fn() };

      ws.subscribe('ticker', 'XBT/USD');
      ws.subscribe('ticker', 'XBT/USD');

      // send called only once because second is a duplicate
      expect(ws.ws.send).toHaveBeenCalledTimes(1);
    });
  });

  // ── unsubscribe ──────────────────────────────────────────────

  describe('unsubscribe', () => {
    it('removes from map', () => {
      ws.subscribe('ticker', 'XBT/USD');
      ws.unsubscribe('ticker', 'XBT/USD');

      expect(ws.subscriptions.has('ticker:XBT/USD')).toBe(false);
    });

    it('sends unsubscribe message when connected', () => {
      ws.isConnected = true;
      ws.ws = { send: vi.fn() };

      ws.subscribe('ticker', 'XBT/USD');
      ws.unsubscribe('ticker', 'XBT/USD');

      // 1 subscribe + 1 unsubscribe
      expect(ws.ws.send).toHaveBeenCalledTimes(2);
      const unsub = JSON.parse(ws.ws.send.mock.calls[1][0]);
      expect(unsub.event).toBe('unsubscribe');
    });

    it('warns when not subscribed (no throw)', () => {
      // Should not throw even if not subscribed
      expect(() => ws.unsubscribe('ticker', 'XBT/USD')).not.toThrow();
    });
  });

  // ── processKrakenMessage ─────────────────────────────────────

  describe('processKrakenMessage', () => {
    it('parses ticker correctly', () => {
      const msg = createMockWSMessage('kraken', 'ticker');
      const result = ws.processKrakenMessage(msg);

      expect(result.type).toBe('ticker');
      expect(result.exchange).toBe('kraken');
      expect(result.pair).toBe('XBT/USD');
      expect(result.data.price).toBe('50000');
    });

    it('parses trade correctly', () => {
      const msg = createMockWSMessage('kraken', 'trade');
      const result = ws.processKrakenMessage(msg);

      expect(result.type).toBe('trade');
      expect(result.exchange).toBe('kraken');
      expect(result.pair).toBe('XBT/USD');
      expect(result.data).toBeInstanceOf(Array);
      expect(result.data[0].price).toBe('50000');
    });

    it('parses orderbook correctly', () => {
      const msg = [0, { bs: [['50000', '1']], as: [['50010', '2']] }, 'book', 'XBT/USD'];
      const result = ws.processKrakenMessage(msg);

      expect(result.type).toBe('orderbook');
      expect(result.data.bids).toEqual([['50000', '1']]);
      expect(result.data.asks).toEqual([['50010', '2']]);
    });

    it('ignores heartbeat', () => {
      const msg = { event: 'heartbeat' };
      const result = ws.processKrakenMessage(msg);
      expect(result).toBeNull();
    });
  });

  // ── processBinanceMessage ────────────────────────────────────

  describe('processBinanceMessage', () => {
    it('parses trade correctly', () => {
      const bws = new MarketDataWebSocket('binance');
      const msg = createMockWSMessage('binance', 'trade');
      const result = bws.processBinanceMessage(msg);

      expect(result.type).toBe('trade');
      expect(result.exchange).toBe('binance');
      expect(result.pair).toBe('BTCUSD');
      expect(result.data.price).toBe('50000');
    });

    it('parses ticker correctly', () => {
      const bws = new MarketDataWebSocket('binance');
      const msg = createMockWSMessage('binance', 'ticker');
      const result = bws.processBinanceMessage(msg);

      expect(result.type).toBe('ticker');
      expect(result.exchange).toBe('binance');
      expect(result.data.price).toBe('50000');
    });

    it('parses depth update correctly', () => {
      const bws = new MarketDataWebSocket('binance');
      const msg = {
        e: 'depthUpdate', s: 'BTCUSD',
        b: [['50000', '1']], a: [['50010', '2']],
        u: 100, U: 99
      };
      const result = bws.processBinanceMessage(msg);

      expect(result.type).toBe('orderbook');
      expect(result.data.bids).toEqual([['50000', '1']]);
      expect(result.data.asks).toEqual([['50010', '2']]);
    });
  });

  // ── processCoinbaseMessage ───────────────────────────────────

  describe('processCoinbaseMessage', () => {
    it('parses ticker correctly', () => {
      const cws = new MarketDataWebSocket('coinbase');
      const msg = createMockWSMessage('coinbase', 'ticker');
      const result = cws.processCoinbaseMessage(msg);

      expect(result.type).toBe('ticker');
      expect(result.exchange).toBe('coinbase');
      expect(result.pair).toBe('BTC-USD');
      expect(result.data.price).toBe('50000');
    });

    it('parses match correctly', () => {
      const cws = new MarketDataWebSocket('coinbase');
      const msg = createMockWSMessage('coinbase', 'trade');
      const result = cws.processCoinbaseMessage(msg);

      expect(result.type).toBe('trade');
      expect(result.exchange).toBe('coinbase');
      expect(result.data.price).toBe('50000');
    });

    it('parses snapshot correctly', () => {
      const cws = new MarketDataWebSocket('coinbase');
      const msg = {
        type: 'snapshot', product_id: 'BTC-USD',
        bids: [['50000', '1']], asks: [['50010', '2']]
      };
      const result = cws.processCoinbaseMessage(msg);

      expect(result.type).toBe('orderbook');
      expect(result.data.bids).toEqual([['50000', '1']]);
    });

    it('parses l2update correctly', () => {
      const cws = new MarketDataWebSocket('coinbase');
      const msg = {
        type: 'l2update', product_id: 'BTC-USD',
        changes: [['buy', '50000', '1.5']]
      };
      const result = cws.processCoinbaseMessage(msg);

      expect(result.type).toBe('orderbook_update');
      expect(result.data.changes).toEqual([['buy', '50000', '1.5']]);
    });
  });

  // ── createSubscriptionMessage ────────────────────────────────

  describe('createSubscriptionMessage', () => {
    it('correct format for kraken', () => {
      const msg = ws.createSubscriptionMessage('ticker', 'XBT/USD');

      expect(msg.event).toBe('subscribe');
      expect(msg.pair).toEqual(['XBT/USD']);
      expect(msg.subscription.name).toBe('ticker');
    });

    it('correct format for binance', () => {
      const bws = new MarketDataWebSocket('binance');
      const msg = bws.createSubscriptionMessage('trade', 'BTCUSD');

      expect(msg.method).toBe('SUBSCRIBE');
      expect(msg.params).toEqual(['btcusd@trade']);
    });

    it('correct format for coinbase', () => {
      const cws = new MarketDataWebSocket('coinbase');
      const msg = cws.createSubscriptionMessage('ticker', 'BTC-USD');

      expect(msg.type).toBe('subscribe');
      expect(msg.product_ids).toEqual(['BTC-USD']);
      expect(msg.channels).toEqual(['ticker']);
    });
  });

  // ── resubscribeAll ───────────────────────────────────────────

  describe('resubscribeAll', () => {
    it('sends subscription for each entry (bug fix)', () => {
      // Pre-populate subscriptions (as if they existed before reconnect)
      ws.subscriptions.set('ticker:XBT/USD', {
        channel: 'ticker', pair: 'XBT/USD',
        subscription: ws.createSubscriptionMessage('ticker', 'XBT/USD')
      });
      ws.subscriptions.set('trade:XBT/USD', {
        channel: 'trade', pair: 'XBT/USD',
        subscription: ws.createSubscriptionMessage('trade', 'XBT/USD')
      });

      ws.isConnected = true;
      ws.ws = { send: vi.fn() };

      ws.resubscribeAll();

      expect(ws.ws.send).toHaveBeenCalledTimes(2);
    });

    it('handles empty subscriptions', () => {
      ws.isConnected = true;
      ws.ws = { send: vi.fn() };

      // Should not throw or send anything
      ws.resubscribeAll();

      expect(ws.ws.send).not.toHaveBeenCalled();
    });
  });

  // ── handleOpen ───────────────────────────────────────────────

  describe('handleOpen', () => {
    it('sets isConnected true', () => {
      // Stub startHeartbeat and resubscribeAll to avoid side-effects
      ws.startHeartbeat = vi.fn();
      ws.resubscribeAll = vi.fn();

      ws.handleOpen();

      expect(ws.isConnected).toBe(true);
    });

    it('resets reconnectAttempts', () => {
      ws.reconnectAttempts = 3;
      ws.startHeartbeat = vi.fn();
      ws.resubscribeAll = vi.fn();

      ws.handleOpen();

      expect(ws.reconnectAttempts).toBe(0);
    });
  });

  // ── handleClose ──────────────────────────────────────────────

  describe('handleClose', () => {
    it('sets isConnected false', () => {
      ws.isConnected = true;
      ws.stopHeartbeat = vi.fn();
      // Prevent actual reconnect
      ws.reconnectAttempts = 999;
      ws.maxReconnectAttempts = 5;

      ws.handleClose(1000, 'normal');

      expect(ws.isConnected).toBe(false);
    });
  });

  // ── getStatus ────────────────────────────────────────────────

  describe('getStatus', () => {
    it('returns correct status object', () => {
      ws.subscribe('ticker', 'XBT/USD');
      ws.lastMessageTime = 12345;

      const status = ws.getStatus();

      expect(status.exchange).toBe('kraken');
      expect(status.isConnected).toBe(false);
      expect(status.reconnectAttempts).toBe(0);
      expect(status.subscriptionsCount).toBe(1);
      expect(status.lastMessageTime).toBe(12345);
      expect(status.subscriptions).toEqual(['ticker:XBT/USD']);
    });
  });
});
