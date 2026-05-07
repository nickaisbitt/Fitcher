const PaperTradingAdapter = require('../../src/adapters/PaperTradingAdapter');

describe('PaperTradingAdapter', () => {
  describe('getBalance', () => {
    it('should return default initial virtual balance', async () => {
      // Set latencyMs to 0 so we don't have to wait or mock timers
      const adapter = new PaperTradingAdapter({ latencyMs: 0 });

      const balance = await adapter.getBalance();

      expect(balance).toEqual({
        USD: 100000,
        BTC: 0,
        ETH: 0
      });
    });

    it('should return custom initial virtual balance when configured', async () => {
      const adapter = new PaperTradingAdapter({ initialBalance: 50000, latencyMs: 0 });

      const balance = await adapter.getBalance();

      expect(balance).toEqual({
        USD: 50000,
        BTC: 0,
        ETH: 0
      });
    });

    it('should return a new object and not a reference to internal state', async () => {
      const adapter = new PaperTradingAdapter({ latencyMs: 0 });

      const balance1 = await adapter.getBalance();

      // Modify the returned balance object
      balance1.USD = 0;

      const balance2 = await adapter.getBalance();

      // The original internal state should be unaffected
      expect(balance2.USD).toBe(100000);
      expect(balance1).not.toBe(balance2);
    });

    it('should reflect balance changes after executing a trade', async () => {
      const adapter = new PaperTradingAdapter({ initialBalance: 100000, latencyMs: 0, baseSlippage: 0, slippageModel: 'fixed' });

      // Mock price feed so createOrder knows the price
      const mockPriceFeed = {
        getPrice: (symbol) => {
          if (symbol === 'BTC/USD') return 50000;
          return null;
        }
      };
      adapter.setPriceFeed(mockPriceFeed);

      // Execute a market buy order for 1 BTC at $50,000
      const order = await adapter.createOrder({
        symbol: 'BTC/USD',
        type: 'market',
        side: 'buy',
        amount: 1
      });

      const balance = await adapter.getBalance();

      // Calculate exact deducted amount based on the executed order's fill price and fee
      const fillPrice = order.fillPrice;
      const fee = order.fee;
      const totalCost = (1 * fillPrice) + fee;

      expect(balance.USD).toBe(100000 - totalCost);
      expect(balance.BTC).toBe(1);
    });
  });
});
