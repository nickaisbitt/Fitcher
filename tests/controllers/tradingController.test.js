// vitest globals (describe, it, expect, vi) are injected via vitest.config.js globals: true
const tradingController = require('../../src/controllers/tradingController');
const logger = require('../../src/utils/logger');

describe('TradingController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('submitOrder', () => {
    it('should catch error, log it, and return 500 response when order submission fails', async () => {
      const req = {
        body: {
          exchange: 'kraken',
          pair: 'BTC/USD',
          type: 'market',
          side: 'buy',
          amount: 1
        }
      };

      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      };

      const error = new Error('Database connection failed');
      vi.spyOn(tradingController.orderManager, 'createOrder').mockRejectedValue(error);
      vi.spyOn(logger, 'error').mockImplementation(() => {});

      await tradingController.submitOrder(req, res);

      expect(logger.error).toHaveBeenCalledWith('Order submission failed', error);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Order submission failed' });
    });
  });
});
