const marketDataController = require('../../src/controllers/marketDataController');

describe('MarketDataController', () => {
  describe('getTicker', () => {
    let req;
    let res;

    beforeEach(() => {
      req = {
        query: {}
      };
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      };
    });

    it('should return 404 if symbol is missing for getPrice', async () => {
      req.params = { pair: undefined };
      req.query = {};

      // Initialize controller
      await marketDataController.initialize();

      await marketDataController.getPrice(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Price not found',
        code: 'PRICE_NOT_FOUND'
      });
    });
  });
});
