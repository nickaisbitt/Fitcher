/**
 * Tests for src/services/positionManager.js
 */

const redis = require('../../src/utils/redis');
const logger = require('../../src/utils/logger');

// Mock redis via spyOn
vi.spyOn(redis, 'get').mockResolvedValue(null);
vi.spyOn(redis, 'set').mockResolvedValue('OK');
vi.spyOn(redis, 'del').mockResolvedValue(1);
vi.spyOn(redis, 'connect').mockResolvedValue(undefined);
vi.spyOn(redis, 'disconnect').mockResolvedValue(undefined);

// Mock logger to prevent output
vi.spyOn(logger, 'info').mockImplementation(() => {});
vi.spyOn(logger, 'warn').mockImplementation(() => {});
vi.spyOn(logger, 'error').mockImplementation(() => {});
vi.spyOn(logger, 'debug').mockImplementation(() => {});

const PositionManager = require('../../src/services/positionManager');

describe('PositionManager', () => {
  let manager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new PositionManager();
  });

  // ── getPosition (open/create) ────────────────────────────────

  describe('getPosition / openPosition', () => {
    it('creates a new position when none exists', async () => {
      const position = await manager.getPosition('user-1', 'kraken', 'BTC');
      expect(position).toBeDefined();
      expect(position.userId).toBe('user-1');
      expect(position.exchange).toBe('kraken');
      expect(position.asset).toBe('BTC');
      expect(position.totalAmount).toBe(0);
    });

    it('stores the position in the internal map', async () => {
      await manager.getPosition('user-1', 'kraken', 'BTC');
      const key = manager.getPositionKey('user-1', 'kraken', 'BTC');
      expect(manager.positions.has(key)).toBe(true);
    });

    it('returns existing position on subsequent calls', async () => {
      const p1 = await manager.getPosition('user-1', 'kraken', 'BTC');
      const p2 = await manager.getPosition('user-1', 'kraken', 'BTC');
      expect(p1).toBe(p2);
    });

    it('normalizes asset to uppercase', async () => {
      const position = await manager.getPosition('user-1', 'kraken', 'btc');
      expect(position.asset).toBe('BTC');
    });

    it('sets default pair to ASSET/USD', async () => {
      const position = await manager.getPosition('user-1', 'kraken', 'ETH');
      expect(position.pair).toBe('ETH/USD');
    });

    it('accepts custom pair', async () => {
      const position = await manager.getPosition('user-1', 'kraken', 'BTC', 'BTC/EUR');
      expect(position.pair).toBe('BTC/EUR');
    });

    it('returns null-like (creates new) for nonexistent position', async () => {
      // getPosition always creates if not found, so it never returns null
      const position = await manager.getPosition('user-999', 'unknown', 'XYZ');
      expect(position).toBeDefined();
      expect(position.totalAmount).toBe(0);
    });

    it('tries to load from redis if not in memory', async () => {
      await manager.getPosition('user-1', 'kraken', 'BTC');
      expect(redis.get).toHaveBeenCalled();
    });
  });

  // ── updatePositionFromTrade ──────────────────────────────────

  describe('updatePositionFromTrade', () => {
    it('increases position on buy', async () => {
      const position = await manager.updatePositionFromTrade('user-1', 'kraken', {
        pair: 'BTC/USD', side: 'buy', amount: 0.5, price: 50000, fee: 5
      });

      expect(position.totalAmount).toBe(0.5);
      expect(position.averageEntryPrice).toBeGreaterThan(0);
    });

    it('decreases position on sell', async () => {
      // First buy
      await manager.updatePositionFromTrade('user-1', 'kraken', {
        pair: 'BTC/USD', side: 'buy', amount: 1.0, price: 50000, fee: 5
      });

      // Then sell
      const position = await manager.updatePositionFromTrade('user-1', 'kraken', {
        pair: 'BTC/USD', side: 'sell', amount: 0.5, price: 51000, fee: 5
      });

      expect(position.totalAmount).toBe(0.5);
    });

    it('closes position when fully sold', async () => {
      await manager.updatePositionFromTrade('user-1', 'kraken', {
        pair: 'BTC/USD', side: 'buy', amount: 1.0, price: 50000, fee: 5
      });

      const position = await manager.updatePositionFromTrade('user-1', 'kraken', {
        pair: 'BTC/USD', side: 'sell', amount: 1.0, price: 51000, fee: 5
      });

      expect(position.totalAmount).toBe(0);
      expect(position.isFlat()).toBe(true);
    });

    it('calculates weighted average entry price', async () => {
      // Buy 0.5 at 50000
      await manager.updatePositionFromTrade('user-1', 'kraken', {
        pair: 'BTC/USD', side: 'buy', amount: 0.5, price: 50000, fee: 0
      });

      // Buy 0.5 at 52000
      const position = await manager.updatePositionFromTrade('user-1', 'kraken', {
        pair: 'BTC/USD', side: 'buy', amount: 0.5, price: 52000, fee: 0
      });

      // Weighted average: (0.5*50000 + 0.5*52000) / 1.0 = 51000
      expect(position.averageEntryPrice).toBe(51000);
    });

    it('tracks realized PnL on sell', async () => {
      await manager.updatePositionFromTrade('user-1', 'kraken', {
        pair: 'BTC/USD', side: 'buy', amount: 1.0, price: 50000, fee: 0
      });

      const position = await manager.updatePositionFromTrade('user-1', 'kraken', {
        pair: 'BTC/USD', side: 'sell', amount: 1.0, price: 55000, fee: 0
      });

      // Realized PnL: (55000 - 50000) * 1.0 = 5000
      expect(position.realizedPnL).toBe(5000);
    });

    it('persists position to redis after trade', async () => {
      vi.clearAllMocks();
      await manager.updatePositionFromTrade('user-1', 'kraken', {
        pair: 'BTC/USD', side: 'buy', amount: 0.5, price: 50000, fee: 5
      });
      expect(redis.set).toHaveBeenCalled();
    });

    it('tracks fees across trades', async () => {
      await manager.updatePositionFromTrade('user-1', 'kraken', {
        pair: 'BTC/USD', side: 'buy', amount: 0.5, price: 50000, fee: 5
      });
      const position = await manager.updatePositionFromTrade('user-1', 'kraken', {
        pair: 'BTC/USD', side: 'buy', amount: 0.5, price: 51000, fee: 3
      });

      expect(position.totalFees).toBe(8);
    });

    it('throws on error', async () => {
      // Force getPosition to throw
      vi.spyOn(manager, 'getPosition').mockRejectedValueOnce(new Error('redis down'));
      await expect(
        manager.updatePositionFromTrade('user-1', 'kraken', {
          pair: 'BTC/USD', side: 'buy', amount: 0.5, price: 50000, fee: 5
        })
      ).rejects.toThrow('redis down');
    });
  });

  // ── getUserPositions ─────────────────────────────────────────

  describe('getUserPositions', () => {
    beforeEach(async () => {
      await manager.updatePositionFromTrade('user-1', 'kraken', {
        pair: 'BTC/USD', side: 'buy', amount: 0.5, price: 50000, fee: 5
      });
      await manager.updatePositionFromTrade('user-1', 'kraken', {
        pair: 'ETH/USD', side: 'buy', amount: 2.0, price: 3000, fee: 3
      });
      await manager.updatePositionFromTrade('user-2', 'binance', {
        pair: 'BTC/USD', side: 'buy', amount: 1.0, price: 49000, fee: 5
      });
    });

    it('returns all positions for a user', async () => {
      const positions = await manager.getUserPositions('user-1');
      expect(positions.length).toBe(2);
    });

    it('filters by exchange', async () => {
      const positions = await manager.getUserPositions('user-1', 'kraken');
      expect(positions.length).toBe(2);
      expect(positions.every(p => p.exchange === 'kraken')).toBe(true);
    });

    it('returns empty for user with no positions', async () => {
      const positions = await manager.getUserPositions('user-999');
      expect(positions).toEqual([]);
    });
  });

  // ── getPortfolioSummary ──────────────────────────────────────

  describe('getPortfolioSummary', () => {
    it('returns total value including all positions', async () => {
      await manager.updatePositionFromTrade('user-1', 'kraken', {
        pair: 'BTC/USD', side: 'buy', amount: 1.0, price: 50000, fee: 0
      });
      await manager.updatePositionFromTrade('user-1', 'kraken', {
        pair: 'ETH/USD', side: 'buy', amount: 10.0, price: 3000, fee: 0
      });

      const summary = await manager.getPortfolioSummary('user-1', { BTC: 55000, ETH: 3200 });

      expect(summary.userId).toBe('user-1');
      expect(summary.positionCount).toBe(2);
      expect(summary.totalValue).toBeGreaterThan(0);
    });

    it('calculates unrealized PnL', async () => {
      await manager.updatePositionFromTrade('user-1', 'kraken', {
        pair: 'BTC/USD', side: 'buy', amount: 1.0, price: 50000, fee: 0
      });

      const summary = await manager.getPortfolioSummary('user-1', { BTC: 55000 });

      // Unrealized PnL: (55000 - 50000) * 1.0 = 5000
      expect(summary.totalUnrealizedPnL).toBe(5000);
    });

    it('includes realized PnL', async () => {
      await manager.updatePositionFromTrade('user-1', 'kraken', {
        pair: 'BTC/USD', side: 'buy', amount: 1.0, price: 50000, fee: 0
      });
      await manager.updatePositionFromTrade('user-1', 'kraken', {
        pair: 'BTC/USD', side: 'sell', amount: 0.5, price: 55000, fee: 0
      });

      const summary = await manager.getPortfolioSummary('user-1', { BTC: 55000 });

      expect(summary.totalRealizedPnL).toBeGreaterThan(0);
    });

    it('returns zeros for empty portfolio', async () => {
      const summary = await manager.getPortfolioSummary('user-999', {});

      expect(summary.totalValue).toBe(0);
      expect(summary.totalCost).toBe(0);
      expect(summary.totalRealizedPnL).toBe(0);
      expect(summary.totalUnrealizedPnL).toBe(0);
      expect(summary.positionCount).toBe(0);
    });

    it('includes total fees', async () => {
      await manager.updatePositionFromTrade('user-1', 'kraken', {
        pair: 'BTC/USD', side: 'buy', amount: 1.0, price: 50000, fee: 10
      });

      const summary = await manager.getPortfolioSummary('user-1', { BTC: 50000 });
      expect(summary.totalFees).toBe(10);
    });
  });

  // ── multiple positions for same user different pairs ─────────

  describe('multiple positions for same user, different pairs', () => {
    it('maintains separate positions per asset', async () => {
      await manager.updatePositionFromTrade('user-1', 'kraken', {
        pair: 'BTC/USD', side: 'buy', amount: 1.0, price: 50000, fee: 0
      });
      await manager.updatePositionFromTrade('user-1', 'kraken', {
        pair: 'ETH/USD', side: 'buy', amount: 10.0, price: 3000, fee: 0
      });

      const btcKey = manager.getPositionKey('user-1', 'kraken', 'BTC');
      const ethKey = manager.getPositionKey('user-1', 'kraken', 'ETH');

      expect(manager.positions.get(btcKey).totalAmount).toBe(1.0);
      expect(manager.positions.get(ethKey).totalAmount).toBe(10.0);
    });
  });

  // ── position with fees ───────────────────────────────────────

  describe('position with fees', () => {
    it('includes fee in cost basis for buy', async () => {
      const position = await manager.updatePositionFromTrade('user-1', 'kraken', {
        pair: 'BTC/USD', side: 'buy', amount: 1.0, price: 50000, fee: 50
      });

      // Cost = amount * price + fee = 50000 + 50 = 50050
      expect(position.totalCost).toBe(50050);
      expect(position.averageEntryPrice).toBe(50050);
    });
  });

  // ── get position by key ──────────────────────────────────────

  describe('getPositionKey', () => {
    it('generates consistent keys', () => {
      const key = manager.getPositionKey('user-1', 'kraken', 'btc');
      expect(key).toBe('user-1:kraken:BTC');
    });

    it('different assets produce different keys', () => {
      const k1 = manager.getPositionKey('user-1', 'kraken', 'BTC');
      const k2 = manager.getPositionKey('user-1', 'kraken', 'ETH');
      expect(k1).not.toBe(k2);
    });
  });

  // ── updateUnrealizedPnL on price change ──────────────────────

  describe('update unrealized PnL on price change', () => {
    it('recalculates unrealized PnL when price changes', async () => {
      await manager.updatePositionFromTrade('user-1', 'kraken', {
        pair: 'BTC/USD', side: 'buy', amount: 1.0, price: 50000, fee: 0
      });

      const key = manager.getPositionKey('user-1', 'kraken', 'BTC');
      const position = manager.positions.get(key);

      position.updateUnrealizedPnL(55000);
      expect(position.unrealizedPnL).toBe(5000);
      expect(position.totalValue).toBe(55000);

      position.updateUnrealizedPnL(45000);
      expect(position.unrealizedPnL).toBe(-5000);
      expect(position.totalValue).toBe(45000);
    });

    it('sets unrealized PnL to 0 for flat position', async () => {
      await manager.updatePositionFromTrade('user-1', 'kraken', {
        pair: 'BTC/USD', side: 'buy', amount: 1.0, price: 50000, fee: 0
      });
      await manager.updatePositionFromTrade('user-1', 'kraken', {
        pair: 'BTC/USD', side: 'sell', amount: 1.0, price: 55000, fee: 0
      });

      const key = manager.getPositionKey('user-1', 'kraken', 'BTC');
      const position = manager.positions.get(key);

      position.updateUnrealizedPnL(60000);
      expect(position.unrealizedPnL).toBe(0);
    });
  });

  // ── position status transitions ──────────────────────────────

  describe('position status transitions', () => {
    it('transitions from flat to long on buy', async () => {
      const position = await manager.getPosition('user-1', 'kraken', 'BTC');
      expect(position.isFlat()).toBe(true);
      expect(position.isLong()).toBe(false);

      await manager.updatePositionFromTrade('user-1', 'kraken', {
        pair: 'BTC/USD', side: 'buy', amount: 1.0, price: 50000, fee: 0
      });

      expect(position.isFlat()).toBe(false);
      expect(position.isLong()).toBe(true);
    });

    it('transitions back to flat on full sell', async () => {
      await manager.updatePositionFromTrade('user-1', 'kraken', {
        pair: 'BTC/USD', side: 'buy', amount: 1.0, price: 50000, fee: 0
      });
      await manager.updatePositionFromTrade('user-1', 'kraken', {
        pair: 'BTC/USD', side: 'sell', amount: 1.0, price: 55000, fee: 0
      });

      const key = manager.getPositionKey('user-1', 'kraken', 'BTC');
      const position = manager.positions.get(key);
      expect(position.isFlat()).toBe(true);
    });
  });

  // ── empty portfolio returns zeros ────────────────────────────

  describe('empty portfolio returns zeros', () => {
    it('getPortfolioSummary returns zero totals', async () => {
      const summary = await manager.getPortfolioSummary('new-user');

      expect(summary.totalValue).toBe(0);
      expect(summary.totalCost).toBe(0);
      expect(summary.totalPnL).toBe(0);
      expect(summary.pnlPercent).toBe(0);
      expect(summary.totalFees).toBe(0);
      expect(summary.positionCount).toBe(0);
      expect(summary.positions).toEqual([]);
    });
  });
});
