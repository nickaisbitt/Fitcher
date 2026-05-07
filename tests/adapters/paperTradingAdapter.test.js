const PaperTradingAdapter = require('../../src/adapters/PaperTradingAdapter');
const logger = require('../../src/utils/logger');

// Mock logger to prevent terminal noise during tests
vi.mock('../../src/utils/logger', () => {
  return {
    default: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn()
    },
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  };
});

describe('PaperTradingAdapter', () => {
  let adapter;
  let mockPriceFeed;

  beforeEach(() => {
    // Reset any previous state
    vi.clearAllMocks();

    mockPriceFeed = {
      getPrice: vi.fn()
    };

    adapter = new PaperTradingAdapter({
      initialBalance: 10000,
      latencyMs: 0, // Eliminate latency for fast tests
      slippageModel: 'fixed',
      baseSlippage: 0.001 // 0.1%
    });

    adapter.setPriceFeed(mockPriceFeed);
  });

  describe('Initialization & Basics', () => {
    it('should initialize with default virtual balance if none provided', () => {
      const defaultAdapter = new PaperTradingAdapter({ latencyMs: 0 });
      expect(defaultAdapter.getVirtualBalance()).toEqual({
        USD: 100000,
        BTC: 0,
        ETH: 0
      });
    });

    it('should initialize with provided initial balance', () => {
      expect(adapter.getVirtualBalance()).toEqual({
        USD: 10000,
        BTC: 0,
        ETH: 0
      });
    });

    it('should connect and log the activation', async () => {
      // Mock spyOn because dynamic imports/mocks in vitest sometimes don't retain spy properties
      const infoSpy = vi.spyOn(logger, 'info');
      const result = await adapter.connect();
      expect(result).toBe(true);
      expect(adapter.isConnected).toBe(true);
      expect(infoSpy).toHaveBeenCalledWith('✅ Paper trading mode activated');
    });

    it('should get balance', async () => {
      const balance = await adapter.getBalance();
      expect(balance).toEqual({
        USD: 10000,
        BTC: 0,
        ETH: 0
      });
    });

    it('should reset the paper trading data', async () => {
      // Setup some initial state to clear
      adapter.virtualBalance.BTC = 5;
      adapter.openOrders.set('test-order', {});
      adapter.orderHistory.push({});
      adapter.trades.push({});

      adapter.reset(50000);

      expect(adapter.getVirtualBalance()).toEqual({
        USD: 50000,
        BTC: 0,
        ETH: 0
      });
      expect(adapter.openOrders.size).toBe(0);
      expect(adapter.orderHistory.length).toBe(0);
      expect(adapter.trades.length).toBe(0);
    });
  });

  describe('calculateFillPrice', () => {
    it('should calculate correct fill price for market buy with fixed slippage', () => {
      // baseSlippage is 0.001, so 1 + 0.001 = 1.001
      const fillPrice = adapter.calculateFillPrice(100, 'buy', 'market');
      expect(fillPrice).toBeCloseTo(100.1, 5);
    });

    it('should calculate correct fill price for market sell with fixed slippage', () => {
      // baseSlippage is 0.001, so 1 - 0.001 = 0.999
      const fillPrice = adapter.calculateFillPrice(100, 'sell', 'market');
      expect(fillPrice).toBeCloseTo(99.9, 5);
    });

    it('should calculate correct fill price for limit buy (fill at limit or better)', () => {
      // Market is 100, slightly slippage makes it 100.1. Limit is 105. Fill at 100.1
      const fillPrice1 = adapter.calculateFillPrice(100, 'buy', 'limit', 105);
      expect(fillPrice1).toBe(100.1);

      // Market is 100. Limit is 90. Math.min(90, 100.1) => 90
      const fillPrice2 = adapter.calculateFillPrice(100, 'buy', 'limit', 90);
      expect(fillPrice2).toBe(90);
    });

    it('should calculate correct fill price for limit sell (fill at limit or better)', () => {
      // Market is 100, slight slippage makes it 99.9. Limit is 95. Fill at 99.9
      const fillPrice1 = adapter.calculateFillPrice(100, 'sell', 'limit', 95);
      expect(fillPrice1).toBe(99.9);

      // Market is 100. Limit is 110. Math.max(110, 99.9) => 110
      const fillPrice2 = adapter.calculateFillPrice(100, 'sell', 'limit', 110);
      expect(fillPrice2).toBe(110);
    });
  });

  describe('createOrder', () => {
    it('should create an open limit order without immediate execution', async () => {
      mockPriceFeed.getPrice.mockReturnValue(50000); // 1 BTC = $50,000

      const orderParams = {
        symbol: 'BTC/USD',
        type: 'limit',
        side: 'buy',
        amount: 0.1,
        price: 49000
      };

      const order = await adapter.createOrder(orderParams);

      expect(order.status).toBe('open');
      expect(order.type).toBe('limit');
      expect(order.filled).toBe(0);
      expect(order.remaining).toBe(0.1);

      // Order should be in openOrders map
      expect(adapter.openOrders.has(order.id)).toBe(true);
      expect(adapter.orderHistory.length).toBe(1);
      expect(adapter.trades.length).toBe(0); // No trades yet

      // Balance shouldn't be affected yet
      expect(adapter.getVirtualBalance().USD).toBe(10000);
      expect(adapter.getVirtualBalance().BTC).toBe(0);
    });

    it('should throw an error for buy order if USD balance is insufficient', async () => {
      mockPriceFeed.getPrice.mockReturnValue(50000);

      const orderParams = {
        symbol: 'BTC/USD',
        type: 'market',
        side: 'buy',
        amount: 1 // 1 BTC = $50,050 with slippage, but we only have $10,000
      };

      await expect(adapter.createOrder(orderParams)).rejects.toThrow(/Insufficient USD balance/);
    });

    it('should throw an error for sell order if base currency balance is insufficient', async () => {
      mockPriceFeed.getPrice.mockReturnValue(50000);

      const orderParams = {
        symbol: 'BTC/USD',
        type: 'market',
        side: 'sell',
        amount: 0.1 // We have 0 BTC
      };

      await expect(adapter.createOrder(orderParams)).rejects.toThrow(/Insufficient BTC balance/);
    });
  });

  describe('executePaperTrade', () => {
    it('should properly execute a buy market order and adjust balances', async () => {
      mockPriceFeed.getPrice.mockReturnValue(50000);

      const orderParams = {
        symbol: 'BTC/USD',
        type: 'market',
        side: 'buy',
        amount: 0.1
      };

      // In createOrder, a market buy is immediately executed via executePaperTrade
      const order = await adapter.createOrder(orderParams);

      expect(order.status).toBe('filled');
      expect(order.filled).toBe(0.1);

      // fillPrice = 50000 * 1.001 = 50050
      expect(order.fillPrice).toBeCloseTo(50050, 5);

      // Since order is filled, it shouldn't be in openOrders anymore
      expect(adapter.openOrders.has(order.id)).toBe(false);

      // Trades should be updated
      expect(adapter.trades.length).toBe(1);
      const trade = adapter.trades[0];
      expect(trade.orderId).toBe(order.id);
      expect(trade.side).toBe('buy');

      // Check balance updates
      // fee = amount(0.1) * fillPrice(50050) * 0.002 = 10.01
      // cost = amount(0.1) * fillPrice(50050) = 5005
      // Total deduction = 5005 + 10.01 = 5015.01
      const expectedUsd = 10000 - 5015.01;

      const balance = adapter.getVirtualBalance();
      expect(balance.USD).toBeCloseTo(expectedUsd, 2);
      expect(balance.BTC).toBe(0.1);
    });

    it('should properly execute a sell market order and adjust balances', async () => {
      mockPriceFeed.getPrice.mockReturnValue(50000);

      // Manually add some BTC to sell
      adapter.virtualBalance.BTC = 0.5;

      const orderParams = {
        symbol: 'BTC/USD',
        type: 'market',
        side: 'sell',
        amount: 0.2
      };

      const order = await adapter.createOrder(orderParams);

      expect(order.status).toBe('filled');
      expect(order.filled).toBe(0.2);

      // fillPrice = 50000 * 0.999 = 49950
      expect(order.fillPrice).toBeCloseTo(49950, 5);

      expect(adapter.trades.length).toBe(1);

      // Check balance updates
      // fee = amount(0.2) * fillPrice(49950) * 0.002 = 19.98
      // proceeds = amount(0.2) * fillPrice(49950) = 9990
      // Net proceeds = 9990 - 19.98 = 9970.02
      const expectedUsd = 10000 + 9970.02;

      const balance = adapter.getVirtualBalance();
      expect(balance.USD).toBeCloseTo(expectedUsd, 2);
      // Remaining BTC = 0.5 - 0.2 = 0.3
      expect(balance.BTC).toBe(0.3);
    });
  });

  describe('Other Methods', () => {
    it('should get ticker information', async () => {
      mockPriceFeed.getPrice.mockReturnValue(50000);

      const ticker = await adapter.getTicker('BTC/USD');

      expect(ticker.symbol).toBe('BTC/USD');
      expect(ticker.last).toBe(50000);
      expect(ticker.bid).toBeCloseTo(49950, 5); // 50000 * 0.999
      expect(ticker.ask).toBeCloseTo(50050, 5); // 50000 * 1.001
    });

    it('should get order book with synthetic spread', async () => {
      mockPriceFeed.getPrice.mockReturnValue(50000);

      const orderBook = await adapter.getOrderBook('BTC/USD', 5);

      expect(orderBook.symbol).toBe('BTC/USD');
      expect(orderBook.bids.length).toBe(5);
      expect(orderBook.asks.length).toBe(5);
      expect(orderBook.spread).toBeGreaterThan(0);
    });

    it('should cancel an open order', async () => {
      mockPriceFeed.getPrice.mockReturnValue(50000);

      const orderParams = {
        symbol: 'BTC/USD',
        type: 'limit',
        side: 'buy',
        amount: 0.1,
        price: 40000
      };

      const order = await adapter.createOrder(orderParams);
      expect(adapter.openOrders.has(order.id)).toBe(true);

      const cancelResult = await adapter.cancelOrder(order.id);
      expect(cancelResult).toBe(true);

      expect(adapter.openOrders.has(order.id)).toBe(false);

      const orderStatus = await adapter.getOrderStatus(order.id);
      expect(orderStatus.status).toBe('cancelled');
    });

    it('should get stats', async () => {
      // Simulate some fake history
      adapter.trades = [
        { pnl: 50 },
        { pnl: -10 },
        { pnl: 20 }
      ];

      const stats = adapter.getStats();
      expect(stats.totalTrades).toBe(3);
      expect(stats.winRate).toBe((2/3) * 100);
      expect(stats.totalPnl).toBe(60);
    });
  });
});
