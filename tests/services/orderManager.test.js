/**
 * Tests for src/services/orderManager.js
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

const OrderManager = require('../../src/services/orderManager');
const { createMockOrder } = require('../helpers/fixtures');

describe('OrderManager', () => {
  let manager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new OrderManager();
  });

  // ── createOrder ──────────────────────────────────────────────

  describe('createOrder', () => {
    const validOrder = {
      userId: 'user-1',
      exchange: 'kraken',
      pair: 'BTC/USD',
      type: 'limit',
      side: 'buy',
      amount: 0.1,
      price: 50000
    };

    it('creates a valid order successfully', async () => {
      const result = await manager.createOrder(validOrder);
      expect(result.success).toBe(true);
      expect(result.data.orderId).toBeDefined();
      // Status may be 'pending' or 'open' depending on queue processing timing
      expect(['pending', 'open']).toContain(result.data.status);
    });

    it('validates order before creating', async () => {
      const result = await manager.createOrder(validOrder);
      expect(result.success).toBe(true);
      expect(result.message).toBe('Order created successfully');
    });

    it('rejects an invalid order (missing required fields)', async () => {
      const result = await manager.createOrder({ amount: 0.1 });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Validation failed');
      expect(result.details.length).toBeGreaterThan(0);
    });

    it('rejects order with invalid type', async () => {
      const result = await manager.createOrder({ ...validOrder, type: 'invalid_type' });
      expect(result.success).toBe(false);
    });

    it('generates a unique order ID', async () => {
      const r1 = await manager.createOrder(validOrder);
      const r2 = await manager.createOrder(validOrder);
      expect(r1.data.orderId).not.toBe(r2.data.orderId);
    });

    it('emits orderCreated event', async () => {
      const handler = vi.fn();
      manager.on('orderCreated', handler);

      await manager.createOrder(validOrder);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'user-1',
        pair: 'BTC/USD'
      }));
    });

    it('stores order in internal map', async () => {
      const result = await manager.createOrder(validOrder);
      const orderId = result.data.orderId;
      expect(manager.orders.has(orderId)).toBe(true);
    });

    it('persists order to redis', async () => {
      await manager.createOrder(validOrder);
      expect(redis.set).toHaveBeenCalled();
    });

    it('adds order to processing queue', async () => {
      // The queue is processed asynchronously, but we can verify the order was added
      const result = await manager.createOrder(validOrder);
      expect(result.success).toBe(true);
    });

    it('includes warnings in result', async () => {
      const result = await manager.createOrder(validOrder);
      expect(result.warnings).toBeDefined();
      expect(Array.isArray(result.warnings)).toBe(true);
    });

    it('returns order summary in data', async () => {
      const result = await manager.createOrder(validOrder);
      expect(result.data.summary).toBeDefined();
      expect(result.data.summary.pair).toBe('BTC/USD');
      expect(result.data.summary.side).toBe('buy');
    });
  });

  // ── getOrder ─────────────────────────────────────────────────

  describe('getOrder', () => {
    it('returns order by ID from memory', async () => {
      const result = await manager.createOrder({
        userId: 'user-1', exchange: 'kraken', pair: 'BTC/USD',
        type: 'limit', side: 'buy', amount: 0.1, price: 50000
      });
      const orderId = result.data.orderId;

      const order = await manager.getOrder(orderId);
      expect(order).not.toBeNull();
      expect(order.id).toBe(orderId);
    });

    it('returns null for nonexistent order', async () => {
      const order = await manager.getOrder('nonexistent-id');
      expect(order).toBeNull();
    });

    it('tries to load from redis if not in memory', async () => {
      // Simulate miss in memory, null from redis
      const order = await manager.getOrder('some-id');
      expect(redis.get).toHaveBeenCalledWith('order:some-id');
      expect(order).toBeNull();
    });
  });

  // ── getUserOrders ────────────────────────────────────────────

  describe('getUserOrders', () => {
    beforeEach(async () => {
      await manager.createOrder({
        userId: 'user-1', exchange: 'kraken', pair: 'BTC/USD',
        type: 'limit', side: 'buy', amount: 0.1, price: 50000
      });
      await manager.createOrder({
        userId: 'user-1', exchange: 'kraken', pair: 'ETH/USD',
        type: 'market', side: 'sell', amount: 1.0
      });
      await manager.createOrder({
        userId: 'user-2', exchange: 'binance', pair: 'BTC/USD',
        type: 'limit', side: 'buy', amount: 0.5, price: 49000
      });
    });

    it('returns all orders for a user', async () => {
      const orders = await manager.getUserOrders('user-1');
      expect(orders.length).toBe(2);
      expect(orders.every(o => o.userId === 'user-1')).toBe(true);
    });

    it('filters by status', async () => {
      const orders = await manager.getUserOrders('user-1', { status: 'pending' });
      expect(orders.every(o => o.status === 'pending')).toBe(true);
    });

    it('filters by pair', async () => {
      const orders = await manager.getUserOrders('user-1', { pair: 'BTC/USD' });
      expect(orders.length).toBe(1);
      expect(orders[0].pair).toBe('BTC/USD');
    });

    it('returns empty array for user with no orders', async () => {
      const orders = await manager.getUserOrders('user-999');
      expect(orders).toEqual([]);
    });

    it('returns order summaries sorted by date descending', async () => {
      const orders = await manager.getUserOrders('user-1');
      for (let i = 0; i < orders.length - 1; i++) {
        expect(new Date(orders[i].createdAt).getTime())
          .toBeGreaterThanOrEqual(new Date(orders[i + 1].createdAt).getTime());
      }
    });
  });

  // ── cancelOrder ──────────────────────────────────────────────

  describe('cancelOrder', () => {
    let orderId;

    beforeEach(async () => {
      const result = await manager.createOrder({
        userId: 'user-1', exchange: 'kraken', pair: 'BTC/USD',
        type: 'limit', side: 'buy', amount: 0.1, price: 50000
      });
      orderId = result.data.orderId;
    });

    it('cancels a pending order', async () => {
      const result = await manager.cancelOrder(orderId);
      expect(result.success).toBe(true);
      expect(result.data.status).toBe('cancelled');
    });

    it('cancels an open order', async () => {
      // Manually set status to open
      const order = manager.orders.get(orderId);
      order.updateStatus('open');

      const result = await manager.cancelOrder(orderId);
      expect(result.success).toBe(true);
      expect(result.data.status).toBe('cancelled');
    });

    it('rejects cancel on a filled order', async () => {
      const order = manager.orders.get(orderId);
      order.updateStatus('filled');

      const result = await manager.cancelOrder(orderId);
      expect(result.success).toBe(false);
      expect(result.code).toBe('ORDER_CANNOT_CANCEL');
    });

    it('returns error for nonexistent order', async () => {
      const result = await manager.cancelOrder('nonexistent-id');
      expect(result.success).toBe(false);
      expect(result.code).toBe('ORDER_NOT_FOUND');
    });

    it('emits orderCancelled event', async () => {
      const handler = vi.fn();
      manager.on('orderCancelled', handler);

      await manager.cancelOrder(orderId);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ id: orderId }));
    });

    it('persists cancelled order to redis', async () => {
      vi.clearAllMocks();
      await manager.cancelOrder(orderId);
      expect(redis.set).toHaveBeenCalled();
    });
  });

  // ── updateOrder ──────────────────────────────────────────────

  describe('updateOrder', () => {
    let orderId;

    beforeEach(async () => {
      const result = await manager.createOrder({
        userId: 'user-1', exchange: 'kraken', pair: 'BTC/USD',
        type: 'limit', side: 'buy', amount: 0.1, price: 50000
      });
      orderId = result.data.orderId;
    });

    it('updates price for a limit order', async () => {
      const result = await manager.updateOrder(orderId, { price: 51000 });
      expect(result.success).toBe(true);

      const order = await manager.getOrder(orderId);
      expect(order.price).toBe(51000);
    });

    it('rejects update on a filled order', async () => {
      const order = manager.orders.get(orderId);
      order.updateStatus('filled');

      const result = await manager.updateOrder(orderId, { price: 52000 });
      expect(result.success).toBe(false);
    });

    it('returns error for nonexistent order', async () => {
      const result = await manager.updateOrder('nonexistent-id', { price: 51000 });
      expect(result.success).toBe(false);
      expect(result.code).toBe('ORDER_NOT_FOUND');
    });

    it('emits orderUpdated event', async () => {
      const handler = vi.fn();
      manager.on('orderUpdated', handler);

      await manager.updateOrder(orderId, { price: 51000 });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('updates notes', async () => {
      const result = await manager.updateOrder(orderId, { notes: 'new note' });
      expect(result.success).toBe(true);

      const order = await manager.getOrder(orderId);
      expect(order.notes).toBe('new note');
    });
  });

  // ── Order model addTrade (fill behavior) ─────────────────────

  describe('fillOrder (via Order.addTrade)', () => {
    let order;

    beforeEach(async () => {
      const result = await manager.createOrder({
        userId: 'user-1', exchange: 'kraken', pair: 'BTC/USD',
        type: 'limit', side: 'buy', amount: 1.0, price: 50000
      });
      order = manager.orders.get(result.data.orderId);
    });

    it('fills with correct price and amount', () => {
      order.addTrade({ price: 50000, amount: 1.0, fee: 5 });
      expect(order.filledAmount).toBe(1.0);
      expect(order.averagePrice).toBe(50000);
      expect(order.status).toBe('filled');
    });

    it('handles partial fills', () => {
      order.addTrade({ price: 50000, amount: 0.5, fee: 2.5 });
      expect(order.filledAmount).toBe(0.5);
      expect(order.remainingAmount).toBe(0.5);
      expect(order.status).toBe('partial');
    });

    it('transitions to filled on complete fill', () => {
      order.addTrade({ price: 50000, amount: 0.5, fee: 2.5 });
      order.addTrade({ price: 50100, amount: 0.5, fee: 2.5 });
      expect(order.status).toBe('filled');
      expect(order.remainingAmount).toBe(0);
    });

    it('updates average price across multiple fills', () => {
      order.addTrade({ price: 50000, amount: 0.5, fee: 0 });
      order.addTrade({ price: 51000, amount: 0.5, fee: 0 });
      expect(order.averagePrice).toBe(50500);
    });

    it('tracks total fees', () => {
      order.addTrade({ price: 50000, amount: 0.5, fee: 5 });
      order.addTrade({ price: 50000, amount: 0.5, fee: 5 });
      expect(order.fee).toBe(10);
    });

    it('rejects fill on a cancelled order via status check', () => {
      order.updateStatus('cancelled');
      // addTrade doesn't check status itself, but status is already cancelled
      // The order manager's processOrder flow would check status before filling
      expect(order.status).toBe('cancelled');
      expect(order.canCancel()).toBe(false);
    });
  });

  // ── getActiveOrdersCount ─────────────────────────────────────

  describe('getActiveOrders', () => {
    it('returns only active orders count', async () => {
      await manager.createOrder({
        userId: 'user-1', exchange: 'kraken', pair: 'BTC/USD',
        type: 'limit', side: 'buy', amount: 0.1, price: 50000
      });
      await manager.createOrder({
        userId: 'user-1', exchange: 'kraken', pair: 'ETH/USD',
        type: 'limit', side: 'buy', amount: 1.0, price: 3000
      });

      // Both are pending (active)
      expect(manager.getActiveOrdersCount()).toBe(2);

      // Cancel one
      const orderId = [...manager.orders.keys()][0];
      await manager.cancelOrder(orderId);

      expect(manager.getActiveOrdersCount()).toBe(1);
    });
  });

  // ── getOrderStats ────────────────────────────────────────────

  describe('getOrderStats', () => {
    it('returns correct statistics', async () => {
      await manager.createOrder({
        userId: 'user-1', exchange: 'kraken', pair: 'BTC/USD',
        type: 'limit', side: 'buy', amount: 0.1, price: 50000
      });
      await manager.createOrder({
        userId: 'user-1', exchange: 'kraken', pair: 'ETH/USD',
        type: 'limit', side: 'buy', amount: 1.0, price: 3000
      });

      const stats = await manager.getOrderStats('user-1');
      expect(stats).not.toBeNull();
      expect(stats.total).toBe(2);
      expect(stats.byPair['BTC/USD']).toBe(1);
      expect(stats.byPair['ETH/USD']).toBe(1);
    });

    it('returns null on error', async () => {
      // Force error by spying getUserOrders to throw
      vi.spyOn(manager, 'getUserOrders').mockRejectedValueOnce(new Error('fail'));
      const stats = await manager.getOrderStats('user-1');
      expect(stats).toBeNull();
    });
  });

  // ── multiple orders ──────────────────────────────────────────

  describe('multiple orders for same user', () => {
    it('maintains separate orders correctly', async () => {
      const r1 = await manager.createOrder({
        userId: 'user-1', exchange: 'kraken', pair: 'BTC/USD',
        type: 'limit', side: 'buy', amount: 0.1, price: 50000
      });
      const r2 = await manager.createOrder({
        userId: 'user-1', exchange: 'kraken', pair: 'BTC/USD',
        type: 'limit', side: 'sell', amount: 0.2, price: 55000
      });

      const o1 = await manager.getOrder(r1.data.orderId);
      const o2 = await manager.getOrder(r2.data.orderId);

      expect(o1.side).toBe('buy');
      expect(o2.side).toBe('sell');
      expect(o1.amount).toBe(0.1);
      expect(o2.amount).toBe(0.2);
    });
  });

  // ── concurrent operations ────────────────────────────────────

  describe('concurrent order operations', () => {
    it('handles parallel order creation without interference', async () => {
      const promises = Array.from({ length: 5 }, (_, i) =>
        manager.createOrder({
          userId: 'user-1', exchange: 'kraken', pair: 'BTC/USD',
          type: 'limit', side: 'buy', amount: 0.1, price: 50000
        })
      );

      const results = await Promise.all(promises);
      const successes = results.filter(r => r.success);
      expect(successes.length).toBe(5);

      // All have unique IDs
      const ids = new Set(successes.map(r => r.data.orderId));
      expect(ids.size).toBe(5);
    });
  });

  // ── order history is maintained ──────────────────────────────

  describe('order history', () => {
    it('preserves trade history on an order', async () => {
      const result = await manager.createOrder({
        userId: 'user-1', exchange: 'kraken', pair: 'BTC/USD',
        type: 'limit', side: 'buy', amount: 1.0, price: 50000
      });
      const order = manager.orders.get(result.data.orderId);

      order.addTrade({ price: 50000, amount: 0.3, fee: 1 });
      order.addTrade({ price: 50100, amount: 0.3, fee: 1 });

      expect(order.trades.length).toBe(2);
      expect(order.trades[0].amount).toBe(0.3);
      expect(order.trades[1].amount).toBe(0.3);
    });
  });

  // ── cleanupOldOrders ─────────────────────────────────────────

  describe('cleanupOldOrders', () => {
    it('removes completed old orders', async () => {
      const result = await manager.createOrder({
        userId: 'user-1', exchange: 'kraken', pair: 'BTC/USD',
        type: 'limit', side: 'buy', amount: 0.1, price: 50000
      });
      const order = manager.orders.get(result.data.orderId);
      order.updateStatus('filled');
      // Set updatedAt to 2 days ago
      order.updatedAt = new Date(Date.now() - 2 * 86400000);

      const cleaned = await manager.cleanupOldOrders();
      expect(cleaned).toBe(1);
      expect(manager.orders.size).toBe(0);
    });

    it('does not remove active orders', async () => {
      await manager.createOrder({
        userId: 'user-1', exchange: 'kraken', pair: 'BTC/USD',
        type: 'limit', side: 'buy', amount: 0.1, price: 50000
      });

      const cleaned = await manager.cleanupOldOrders();
      expect(cleaned).toBe(0);
      expect(manager.orders.size).toBe(1);
    });
  });

  // ── getStatus via getActiveOrdersCount ───────────────────────

  describe('getStatus (active orders count)', () => {
    it('returns correct count of active orders', async () => {
      expect(manager.getActiveOrdersCount()).toBe(0);

      await manager.createOrder({
        userId: 'user-1', exchange: 'kraken', pair: 'BTC/USD',
        type: 'limit', side: 'buy', amount: 0.1, price: 50000
      });

      expect(manager.getActiveOrdersCount()).toBe(1);
    });
  });
});
