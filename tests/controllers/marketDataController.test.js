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

    it('should return 400 if symbol is missing', async () => {
      // req.query.symbol is undefined
      await marketDataController.getTicker(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Symbol is required' });
    });
  });
});
