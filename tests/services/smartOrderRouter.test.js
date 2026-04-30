const SmartOrderRouter = require('../../src/services/SmartOrderRouter');
const logger = require('../../src/utils/logger');

describe('SmartOrderRouter', () => {
  let router;

  beforeEach(() => {
    router = new SmartOrderRouter();
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    vi.spyOn(logger, 'info').mockImplementation(() => {});
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('routeOrder', () => {
    it('should catch errors and return a fallback market order', async () => {
      // Force an error in analyzeMarketConditions to trigger the catch block
      const mockError = new Error('Test error forcing fallback');
      vi.spyOn(router, 'analyzeMarketConditions').mockRejectedValue(mockError);

      const mockSignal = {
        pair: 'BTC/USD',
        side: 'buy',
        amount: 1,
        currentPrice: 50000,
      };

      const result = await router.routeOrder(mockSignal, {});

      // Verify logger.error was called with the error
      expect(logger.error).toHaveBeenCalledWith('Order routing failed:', mockError);

      // Verify the fallback order structure
      expect(result).toEqual({
        symbol: mockSignal.pair,
        side: mockSignal.side,
        amount: mockSignal.amount,
        type: 'market',
        orderType: 'market',
        executionStrategy: 'fallback_market',
        reason: 'Smart routing failed - using safe fallback',
        riskMetrics: {
          overallRisk: 0.5
        }
      });
    });
  });
});
