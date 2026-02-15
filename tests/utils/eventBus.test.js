// vitest globals (describe, it, expect) are injected via vitest.config.js globals: true
const eventBus = require('../../src/utils/eventBus');

beforeEach(() => {
  eventBus.clear();
  // Reset metrics between tests
  eventBus.metrics.eventsPublished = 0;
  eventBus.metrics.eventsHandled = 0;
  eventBus.metrics.errors = 0;
});

describe('eventBus', () => {
  // ---------- subscribe / publish ----------
  describe('subscribe and publish', () => {
    it('delivers event data to subscriber', () => {
      const received = [];
      eventBus.subscribe('trade', (data) => received.push(data));
      eventBus.publish('trade', { price: 100 });
      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({ price: 100 });
    });

    it('delivers to multiple subscribers', () => {
      let count = 0;
      eventBus.subscribe('tick', () => count++);
      eventBus.subscribe('tick', () => count++);
      eventBus.publish('tick', {});
      expect(count).toBe(2);
    });

    it('does not deliver events to unrelated subscribers', () => {
      let called = false;
      eventBus.subscribe('other', () => { called = true; });
      eventBus.publish('trade', { price: 50 });
      expect(called).toBe(false);
    });

    it('passes event payload as second argument', () => {
      let payload;
      eventBus.subscribe('info', (_data, evt) => { payload = evt; });
      eventBus.publish('info', 'hello');
      expect(payload).toBeDefined();
      expect(payload.event).toBe('info');
      expect(payload.data).toBe('hello');
      expect(payload.timestamp).toBeGreaterThan(0);
    });
  });

  // ---------- unsubscribe ----------
  describe('unsubscribe', () => {
    it('removes handler so it is no longer called', () => {
      let count = 0;
      const id = eventBus.subscribe('x', () => count++);
      eventBus.publish('x', null);
      expect(count).toBe(1);

      eventBus.unsubscribe('x', id);
      eventBus.publish('x', null);
      expect(count).toBe(1);
    });

    it('returns true when subscription is found', () => {
      const id = eventBus.subscribe('y', () => {});
      expect(eventBus.unsubscribe('y', id)).toBe(true);
    });

    it('returns false for unknown event', () => {
      expect(eventBus.unsubscribe('nonexistent', 'fakeid')).toBe(false);
    });

    it('returns false for unknown subscription id', () => {
      eventBus.subscribe('z', () => {});
      expect(eventBus.unsubscribe('z', 'wrong-id')).toBe(false);
    });
  });

  // ---------- priority ----------
  describe('priority', () => {
    it('calls higher priority handlers first', () => {
      const order = [];
      eventBus.subscribe('p', () => order.push('low'), { priority: 1 });
      eventBus.subscribe('p', () => order.push('high'), { priority: 10 });
      eventBus.subscribe('p', () => order.push('mid'), { priority: 5 });
      eventBus.publish('p', null);
      expect(order).toEqual(['high', 'mid', 'low']);
    });
  });

  // ---------- once ----------
  describe('once option', () => {
    it('handler is called only once then auto-removed', () => {
      let count = 0;
      eventBus.subscribe('once-evt', () => count++, { once: true });
      eventBus.publish('once-evt', null);
      eventBus.publish('once-evt', null);
      eventBus.publish('once-evt', null);
      expect(count).toBe(1);
    });

    it('once handler is removed from subscribers after first call', () => {
      eventBus.subscribe('once-evt2', () => {}, { once: true });
      eventBus.publish('once-evt2', null);
      expect(eventBus.subscribers.has('once-evt2')).toBe(false);
    });
  });

  // ---------- error isolation ----------
  describe('error isolation', () => {
    it('one handler throwing does not prevent others from running', () => {
      const results = [];
      eventBus.subscribe('err-test', () => { throw new Error('boom'); });
      eventBus.subscribe('err-test', () => results.push('ok'));
      eventBus.publish('err-test', null);
      expect(results).toEqual(['ok']);
    });

    it('error increments metrics.errors', () => {
      eventBus.subscribe('err-count', () => { throw new Error('fail'); });
      eventBus.publish('err-count', null);
      expect(eventBus.metrics.errors).toBe(1);
    });
  });

  // ---------- event history ----------
  describe('event history', () => {
    it('getHistory returns published events', () => {
      eventBus.publish('h1', 'a');
      eventBus.publish('h2', 'b');
      const history = eventBus.getHistory();
      expect(history).toHaveLength(2);
      expect(history[0].event).toBe('h1');
      expect(history[1].event).toBe('h2');
    });

    it('getHistory filters by event name', () => {
      eventBus.publish('alpha', 1);
      eventBus.publish('beta', 2);
      eventBus.publish('alpha', 3);
      const filtered = eventBus.getHistory('alpha');
      expect(filtered).toHaveLength(2);
      expect(filtered.every(e => e.event === 'alpha')).toBe(true);
    });

    it('getHistory respects limit', () => {
      for (let i = 0; i < 10; i++) {
        eventBus.publish('flood', i);
      }
      const limited = eventBus.getHistory(null, 3);
      expect(limited).toHaveLength(3);
      // Should return the last 3
      expect(limited[0].data).toBe(7);
      expect(limited[2].data).toBe(9);
    });

    it('enforces maxHistorySize cap', () => {
      const original = eventBus.maxHistorySize;
      eventBus.maxHistorySize = 5;
      for (let i = 0; i < 20; i++) {
        eventBus.publish('capped', i);
      }
      expect(eventBus.eventHistory.length).toBe(5);
      // Oldest kept should be event with data 15
      expect(eventBus.eventHistory[0].data).toBe(15);
      eventBus.maxHistorySize = original;
    });
  });

  // ---------- waitFor ----------
  describe('waitFor', () => {
    it('resolves when event fires', async () => {
      const promise = eventBus.waitFor('signal', 1000);
      eventBus.publish('signal', { value: 42 });
      const result = await promise;
      expect(result).toEqual({ value: 42 });
    });

    it('rejects on timeout', async () => {
      await expect(eventBus.waitFor('never', 50)).rejects.toThrow('Timeout');
    });

    it('resolves only when filter passes', async () => {
      const promise = eventBus.waitFor('filtered', 1000, (data) => data.ready === true);

      // This one should not resolve the promise
      eventBus.publish('filtered', { ready: false });

      // This one should
      eventBus.publish('filtered', { ready: true });

      const result = await promise;
      expect(result.ready).toBe(true);
    });
  });

  // ---------- metrics ----------
  describe('metrics', () => {
    it('tracks eventsPublished', () => {
      eventBus.publish('m1', null);
      eventBus.publish('m2', null);
      expect(eventBus.metrics.eventsPublished).toBe(2);
    });

    it('tracks eventsHandled', () => {
      eventBus.subscribe('handled', () => {});
      eventBus.subscribe('handled', () => {});
      eventBus.publish('handled', null);
      expect(eventBus.metrics.eventsHandled).toBe(2);
    });

    it('tracks errors', () => {
      eventBus.subscribe('err', () => { throw new Error('nope'); });
      eventBus.subscribe('err', () => { throw new Error('also nope'); });
      eventBus.publish('err', null);
      expect(eventBus.metrics.errors).toBe(2);
    });

    it('getMetrics returns subscriber count and event types', () => {
      eventBus.subscribe('type-a', () => {});
      eventBus.subscribe('type-a', () => {});
      eventBus.subscribe('type-b', () => {});
      const m = eventBus.getMetrics();
      expect(m.subscriberCount).toBe(3);
      expect(m.eventTypes).toContain('type-a');
      expect(m.eventTypes).toContain('type-b');
    });

    it('getMetrics includes historySize', () => {
      eventBus.publish('h', 1);
      eventBus.publish('h', 2);
      const m = eventBus.getMetrics();
      expect(m.historySize).toBe(2);
    });
  });

  // ---------- clear ----------
  describe('clear', () => {
    it('removes all subscribers and history', () => {
      eventBus.subscribe('clearme', () => {});
      eventBus.publish('clearme', 1);
      eventBus.clear();
      expect(eventBus.subscribers.size).toBe(0);
      expect(eventBus.eventHistory).toHaveLength(0);
    });
  });

  // ---------- edge cases ----------
  describe('edge cases', () => {
    it('publish with no subscribers does not throw', () => {
      expect(() => eventBus.publish('nobody-listens', { data: 1 })).not.toThrow();
    });

    it('subscribe validates handler is a function', () => {
      expect(() => eventBus.subscribe('bad', 'not-a-function')).toThrow('must be a function');
      expect(() => eventBus.subscribe('bad', null)).toThrow('must be a function');
      expect(() => eventBus.subscribe('bad', 42)).toThrow('must be a function');
    });

    it('subscribe returns a string subscription id', () => {
      const id = eventBus.subscribe('id-test', () => {});
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('publish still records history even with no subscribers', () => {
      eventBus.publish('ghost', 'data');
      const history = eventBus.getHistory('ghost');
      expect(history).toHaveLength(1);
      expect(history[0].data).toBe('data');
    });
  });
});
