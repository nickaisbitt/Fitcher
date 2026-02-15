// vitest globals (describe, it, expect) are injected via vitest.config.js globals: true
const LRUMap = require('../../src/utils/LRUMap');

describe('LRUMap', () => {
  // ---------- Basic operations ----------
  describe('basic operations', () => {
    it('set and get a value', () => {
      const cache = new LRUMap(10);
      cache.set('a', 1);
      expect(cache.get('a')).toBe(1);
    });

    it('has returns true for existing key', () => {
      const cache = new LRUMap(10);
      cache.set('x', 42);
      expect(cache.has('x')).toBe(true);
    });

    it('has returns false for missing key', () => {
      const cache = new LRUMap(10);
      expect(cache.has('missing')).toBe(false);
    });

    it('delete removes a key and returns true', () => {
      const cache = new LRUMap(10);
      cache.set('a', 1);
      expect(cache.delete('a')).toBe(true);
      expect(cache.has('a')).toBe(false);
    });

    it('delete returns false for nonexistent key', () => {
      const cache = new LRUMap(10);
      expect(cache.delete('nope')).toBe(false);
    });

    it('clear removes all entries', () => {
      const cache = new LRUMap(10);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.clear();
      expect(cache.size).toBe(0);
      expect(cache.has('a')).toBe(false);
    });

    it('size reflects number of entries', () => {
      const cache = new LRUMap(10);
      expect(cache.size).toBe(0);
      cache.set('a', 1);
      cache.set('b', 2);
      expect(cache.size).toBe(2);
    });

    it('get returns undefined for nonexistent key', () => {
      const cache = new LRUMap(5);
      expect(cache.get('ghost')).toBeUndefined();
    });
  });

  // ---------- LRU eviction ----------
  describe('LRU eviction', () => {
    it('evicts the oldest entry when exceeding maxSize', () => {
      const cache = new LRUMap(3);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      cache.set('d', 4); // should evict 'a'
      expect(cache.has('a')).toBe(false);
      expect(cache.size).toBe(3);
      expect(cache.get('b')).toBe(2);
      expect(cache.get('d')).toBe(4);
    });

    it('evicts in insertion order', () => {
      const cache = new LRUMap(2);
      cache.set('first', 1);
      cache.set('second', 2);
      cache.set('third', 3); // evicts 'first'
      expect(cache.has('first')).toBe(false);
      expect(cache.has('second')).toBe(true);
      cache.set('fourth', 4); // evicts 'second'
      expect(cache.has('second')).toBe(false);
      expect(cache.has('third')).toBe(true);
    });
  });

  // ---------- Access refresh ----------
  describe('access refresh', () => {
    it('get() refreshes an item so it survives eviction', () => {
      const cache = new LRUMap(3);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);

      // Access 'a' to make it most-recently-used
      cache.get('a');

      // Insert 'd' — should evict 'b' (now oldest), not 'a'
      cache.set('d', 4);
      expect(cache.has('a')).toBe(true);
      expect(cache.has('b')).toBe(false);
    });
  });

  // ---------- Update existing key ----------
  describe('update existing key', () => {
    it('set() on existing key updates value and refreshes position', () => {
      const cache = new LRUMap(3);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);

      // Update 'a' — moves it to end
      cache.set('a', 10);
      expect(cache.get('a')).toBe(10);

      // Insert 'd' — should evict 'b' (oldest), not 'a'
      cache.set('d', 4);
      expect(cache.has('a')).toBe(true);
      expect(cache.has('b')).toBe(false);
      expect(cache.size).toBe(3);
    });

    it('set() on existing key does not increase size', () => {
      const cache = new LRUMap(5);
      cache.set('k', 'v1');
      cache.set('k', 'v2');
      expect(cache.size).toBe(1);
      expect(cache.get('k')).toBe('v2');
    });
  });

  // ---------- Iterators ----------
  describe('iterators', () => {
    it('entries() yields [key, value] pairs', () => {
      const cache = new LRUMap(10);
      cache.set('a', 1);
      cache.set('b', 2);
      const entries = [...cache.entries()];
      expect(entries).toEqual([['a', 1], ['b', 2]]);
    });

    it('keys() yields keys', () => {
      const cache = new LRUMap(10);
      cache.set('x', 10);
      cache.set('y', 20);
      expect([...cache.keys()]).toEqual(['x', 'y']);
    });

    it('values() yields values', () => {
      const cache = new LRUMap(10);
      cache.set('x', 10);
      cache.set('y', 20);
      expect([...cache.values()]).toEqual([10, 20]);
    });

    it('Symbol.iterator works with for...of', () => {
      const cache = new LRUMap(10);
      cache.set('a', 1);
      cache.set('b', 2);
      const collected = [];
      for (const [k, v] of cache) {
        collected.push([k, v]);
      }
      expect(collected).toEqual([['a', 1], ['b', 2]]);
    });

    it('forEach calls callback for each entry', () => {
      const cache = new LRUMap(10);
      cache.set('a', 1);
      cache.set('b', 2);
      const seen = [];
      cache.forEach((value, key) => seen.push([key, value]));
      expect(seen).toEqual([['a', 1], ['b', 2]]);
    });
  });

  // ---------- filter ----------
  describe('filter', () => {
    it('returns values matching predicate', () => {
      const cache = new LRUMap(10);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      const evens = cache.filter(v => v % 2 === 0);
      expect(evens).toEqual([2]);
    });

    it('returns empty array when nothing matches', () => {
      const cache = new LRUMap(10);
      cache.set('a', 1);
      expect(cache.filter(v => v > 100)).toEqual([]);
    });

    it('passes key as second argument', () => {
      const cache = new LRUMap(10);
      cache.set('keep', 1);
      cache.set('drop', 2);
      const result = cache.filter((_, key) => key === 'keep');
      expect(result).toEqual([1]);
    });
  });

  // ---------- toArray ----------
  describe('toArray', () => {
    it('returns all values as an array', () => {
      const cache = new LRUMap(10);
      cache.set('a', 10);
      cache.set('b', 20);
      cache.set('c', 30);
      expect(cache.toArray()).toEqual([10, 20, 30]);
    });

    it('returns empty array for empty cache', () => {
      const cache = new LRUMap(10);
      expect(cache.toArray()).toEqual([]);
    });
  });

  // ---------- Edge cases ----------
  describe('edge cases', () => {
    it('maxSize=1 keeps only the last inserted item', () => {
      const cache = new LRUMap(1);
      cache.set('a', 1);
      cache.set('b', 2);
      expect(cache.size).toBe(1);
      expect(cache.has('a')).toBe(false);
      expect(cache.get('b')).toBe(2);
    });

    it('maxSize=0 throws', () => {
      expect(() => new LRUMap(0)).toThrow('positive integer');
    });

    it('negative maxSize throws', () => {
      expect(() => new LRUMap(-5)).toThrow('positive integer');
    });

    it('non-finite maxSize throws', () => {
      expect(() => new LRUMap(Infinity)).toThrow('positive integer');
      expect(() => new LRUMap(NaN)).toThrow('positive integer');
    });

    it('set() returns this for chaining', () => {
      const cache = new LRUMap(5);
      const result = cache.set('a', 1);
      expect(result).toBe(cache);
    });
  });
});
