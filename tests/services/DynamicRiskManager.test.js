const logger = require('../../src/utils/logger');
vi.spyOn(logger, 'info').mockImplementation(() => {});
vi.spyOn(logger, 'warn').mockImplementation(() => {});
vi.spyOn(logger, 'error').mockImplementation(() => {});
vi.spyOn(logger, 'debug').mockImplementation(() => {});

const DynamicRiskManager = require('../../src/services/DynamicRiskManager');

describe('DynamicRiskManager', () => {
  let riskManager;

  beforeEach(() => {
    vi.clearAllMocks();
    riskManager = new DynamicRiskManager();
  });

  describe('checkTrade', () => {
    it('returns allowed: false when an error is thrown', async () => {
      // Force an error inside checkTrade by mocking a method it calls
      vi.spyOn(riskManager, 'checkCircuitBreaker').mockImplementation(() => {
        throw new Error('Forced system error');
      });

      const signal = { symbol: 'BTC/USD', type: 'buy', amount: 1, price: 50000 };
      const portfolio = { totalValue: 100000, freeBalance: 100000 };

      const result = await riskManager.checkTrade(signal, portfolio);

      expect(result).toEqual({
        allowed: false,
        reason: 'Risk check error: Forced system error',
        level: 3
      });

      // verify that logger.error was called
      expect(logger.error).toHaveBeenCalledWith('Risk check error:', expect.any(Error));
    });
  });
});
