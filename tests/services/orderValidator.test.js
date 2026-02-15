// vitest globals (describe, it, expect) are injected via vitest.config.js globals: true
const OrderValidator = require('../../src/services/orderValidator');
const { createMockOrder } = require('../helpers/fixtures');

describe('OrderValidator', () => {
  let validator;

  beforeEach(() => {
    validator = new OrderValidator();
  });

  // ── validate: required fields & basic validation ─────────────

  describe('validate', () => {
    it('valid market order passes', () => {
      const order = createMockOrder({ type: 'market', price: undefined });
      const result = validator.validate(order);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('valid limit order passes', () => {
      const order = createMockOrder({ type: 'limit', price: 50000 });
      const result = validator.validate(order);
      expect(result.valid).toBe(true);
    });

    it('missing userId fails', () => {
      const order = createMockOrder({ userId: undefined });
      const result = validator.validate(order);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => /user id/i.test(e))).toBe(true);
    });

    it('missing exchange fails', () => {
      const order = createMockOrder({ exchange: undefined });
      const result = validator.validate(order);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => /exchange/i.test(e))).toBe(true);
    });

    it('missing pair fails', () => {
      const order = createMockOrder({ pair: undefined });
      const result = validator.validate(order);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => /pair/i.test(e))).toBe(true);
    });

    it('missing type fails', () => {
      const order = createMockOrder({ type: undefined });
      const result = validator.validate(order);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => /type/i.test(e))).toBe(true);
    });

    it('missing side fails', () => {
      const order = createMockOrder({ side: undefined });
      const result = validator.validate(order);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => /side/i.test(e))).toBe(true);
    });

    it('missing amount fails', () => {
      const order = createMockOrder({ amount: undefined });
      const result = validator.validate(order);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => /amount/i.test(e))).toBe(true);
    });

    it('invalid order type fails', () => {
      const order = createMockOrder({ type: 'foobar' });
      const result = validator.validate(order);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => /invalid order type/i.test(e))).toBe(true);
    });

    it('invalid side fails', () => {
      const order = createMockOrder({ type: 'market', side: 'hold' });
      const result = validator.validate(order);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => /invalid order side/i.test(e))).toBe(true);
    });

    it('limit order without price fails', () => {
      const order = createMockOrder({ type: 'limit', price: undefined });
      const result = validator.validate(order);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => /price.*required/i.test(e))).toBe(true);
    });

    it('stop order without stopPrice fails', () => {
      const order = createMockOrder({ type: 'stop', price: undefined, stopPrice: undefined });
      const result = validator.validate(order);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => /stop price.*required/i.test(e))).toBe(true);
    });

    it('stop_limit order validates both price and stopPrice', () => {
      const order = createMockOrder({
        type: 'stop_limit', price: undefined, stopPrice: undefined
      });
      const result = validator.validate(order);
      expect(result.valid).toBe(false);
      // Should complain about both price and stopPrice
      expect(result.errors.some(e => /price.*required/i.test(e))).toBe(true);
      expect(result.errors.some(e => /stop price.*required/i.test(e))).toBe(true);
    });

    it('invalid pair format fails (e.g. "abc")', () => {
      const order = createMockOrder({ type: 'market', pair: 'abc' });
      const result = validator.validate(order);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => /pair format/i.test(e))).toBe(true);
    });

    it('valid pair formats pass (BTC/USD, ETH-BTC)', () => {
      const order1 = createMockOrder({ type: 'market', pair: 'BTC/USD' });
      const order2 = createMockOrder({ type: 'market', pair: 'ETH-BTC' });

      expect(validator.validate(order1).valid).toBe(true);
      expect(validator.validate(order2).valid).toBe(true);
    });
  });

  // ── validateAmount ───────────────────────────────────────────

  describe('validateAmount', () => {
    it('NaN fails', () => {
      const result = validator.validateAmount(NaN, 'BTC/USD', 'kraken');
      expect(result.valid).toBe(false);
    });

    it('zero fails', () => {
      const result = validator.validateAmount(0, 'BTC/USD', 'kraken');
      expect(result.valid).toBe(false);
    });

    it('negative fails', () => {
      const result = validator.validateAmount(-1, 'BTC/USD', 'kraken');
      expect(result.valid).toBe(false);
    });

    it('below min fails', () => {
      const result = validator.validateAmount(0.00001, 'BTC/USD', 'kraken');
      expect(result.valid).toBe(false);
    });

    it('above max fails', () => {
      const result = validator.validateAmount(9999, 'BTC/USD', 'kraken');
      expect(result.valid).toBe(false);
    });

    it('too many decimal places fails', () => {
      const result = validator.validateAmount(0.123456789, 'BTC/USD', 'kraken');
      expect(result.valid).toBe(false);
    });
  });

  // ── validatePrice ────────────────────────────────────────────

  describe('validatePrice', () => {
    it('NaN fails', () => {
      const result = validator.validatePrice(NaN, 'BTC/USD', 'kraken');
      expect(result.valid).toBe(false);
    });

    it('zero fails', () => {
      const result = validator.validatePrice(0, 'BTC/USD', 'kraken');
      expect(result.valid).toBe(false);
    });

    it('negative fails', () => {
      const result = validator.validatePrice(-100, 'BTC/USD', 'kraken');
      expect(result.valid).toBe(false);
    });
  });

  // ── validateSufficientBalance ────────────────────────────────

  describe('validateSufficientBalance', () => {
    it('returns warning when no provider set', () => {
      const order = createMockOrder({ side: 'buy', amount: 1, price: 50000 });
      const result = validator.validateSufficientBalance(order);

      expect(result.valid).toBe(true);
      expect(result.warning).toBeDefined();
    });

    it('returns valid when balance sufficient', () => {
      validator.setBalanceProvider({
        getAvailableBalance: () => 100000
      });

      const order = createMockOrder({ side: 'buy', amount: 1, price: 50000 });
      const result = validator.validateSufficientBalance(order);
      expect(result.valid).toBe(true);
    });

    it('returns error when balance insufficient', () => {
      validator.setBalanceProvider({
        getAvailableBalance: () => 100
      });

      const order = createMockOrder({ side: 'buy', amount: 1, price: 50000 });
      const result = validator.validateSufficientBalance(order);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/insufficient/i);
    });
  });

  // ── getWarnings ──────────────────────────────────────────────

  describe('getWarnings', () => {
    it('large order generates warning', () => {
      const order = createMockOrder({ amount: 5, price: 50000 });
      const warnings = validator.getWarnings(order);
      expect(warnings.some(w => /large order/i.test(w))).toBe(true);
    });

    it('market order generates slippage warning', () => {
      const order = createMockOrder({ type: 'market' });
      const warnings = validator.getWarnings(order);
      expect(warnings.some(w => /slippage/i.test(w))).toBe(true);
    });
  });

  // ── validateUpdate ───────────────────────────────────────────

  describe('validateUpdate', () => {
    it('cannot update filled order', () => {
      const order = createMockOrder({ status: 'filled' });
      const result = validator.validateUpdate(order, { price: 51000 });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => /cannot update/i.test(e))).toBe(true);
    });
  });
});
