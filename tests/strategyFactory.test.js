// vitest globals (describe, it, expect) are injected via vitest.config.js globals: true
const strategyFactory = require('../src/strategies/strategyFactory');
const MomentumStrategy = require('../src/strategies/MomentumStrategyV2');
const MeanReversionStrategy = require('../src/strategies/MeanReversionStrategyV2');
const GridTradingStrategy = require('../src/strategies/GridTradingStrategyV2');

describe('StrategyFactory', () => {
  it('should throw an error for unknown strategy types', () => {
    expect(() => strategyFactory.createStrategy('invalid_type')).toThrow(/Unknown strategy type: invalid_type/);
  });

  it('should create an instance of a known strategy (momentum)', () => {
    const strategy = strategyFactory.createStrategy('momentum');
    expect(strategy).toBeInstanceOf(MomentumStrategy);
  });

  it('should create an instance of a known strategy (mean_reversion)', () => {
    const strategy = strategyFactory.createStrategy('mean_reversion');
    expect(strategy).toBeInstanceOf(MeanReversionStrategy);
  });

  it('should create an instance of a known strategy (grid)', () => {
    const strategy = strategyFactory.createStrategy('grid');
    expect(strategy).toBeInstanceOf(GridTradingStrategy);
  });

  it('should get available strategy types', () => {
    const types = strategyFactory.getAvailableTypes();
    expect(types).toContain('momentum');
    expect(types).toContain('mean_reversion');
    expect(types).toContain('grid');
  });

  it('should get strategy info for valid strategy', () => {
    const info = strategyFactory.getStrategyInfo('momentum');
    expect(info).toHaveProperty('type', 'momentum');
    expect(info).toHaveProperty('name');
    expect(info).toHaveProperty('defaultConfig');
  });

  it('should return null for unknown strategy info', () => {
    const info = strategyFactory.getStrategyInfo('invalid_type');
    expect(info).toBeNull();
  });

  it('should get all strategy info', () => {
    const allInfo = strategyFactory.getAllStrategyInfo();
    expect(Array.isArray(allInfo)).toBe(true);
    expect(allInfo.length).toBeGreaterThan(0);
    expect(allInfo[0]).toHaveProperty('type');
    expect(allInfo[0]).toHaveProperty('name');
  });
});
