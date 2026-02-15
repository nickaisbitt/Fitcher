/**
 * LRUMap — A simple Least-Recently-Used cache with configurable max size.
 * Used as the in-memory fallback for models when Prisma/DB is not available.
 *
 * Based on Map which maintains insertion order in JS.
 * On get() or set(), the entry is moved to the end (most recent).
 * When size exceeds maxSize, the oldest entry (first in Map) is evicted.
 */
class LRUMap {
  /**
   * @param {number} maxSize - Maximum number of entries before eviction
   */
  constructor(maxSize = 10000) {
    if (!Number.isFinite(maxSize) || maxSize < 1) {
      throw new Error(`LRUMap maxSize must be a positive integer, got: ${maxSize}`);
    }
    this.maxSize = maxSize;
    this._map = new Map();
  }

  /**
   * Get a value by key, refreshing its position (most recently used).
   * @param {*} key
   * @returns {*} The value, or undefined if not found
   */
  get(key) {
    if (!this._map.has(key)) return undefined;

    const value = this._map.get(key);
    // Move to end (most recently used)
    this._map.delete(key);
    this._map.set(key, value);
    return value;
  }

  /**
   * Set a key-value pair. If the key already exists, it's updated and moved to end.
   * If size exceeds maxSize, the least recently used entry is evicted.
   * @param {*} key
   * @param {*} value
   * @returns {LRUMap} this (for chaining)
   */
  set(key, value) {
    // If key exists, delete first so it moves to end
    if (this._map.has(key)) {
      this._map.delete(key);
    }

    this._map.set(key, value);

    // Evict oldest if over capacity
    while (this._map.size > this.maxSize) {
      const oldestKey = this._map.keys().next().value;
      this._map.delete(oldestKey);
    }

    return this;
  }

  /**
   * Check if a key exists without refreshing its position.
   * @param {*} key
   * @returns {boolean}
   */
  has(key) {
    return this._map.has(key);
  }

  /**
   * Delete a key.
   * @param {*} key
   * @returns {boolean} true if the key existed
   */
  delete(key) {
    return this._map.delete(key);
  }

  /**
   * Remove all entries.
   */
  clear() {
    this._map.clear();
  }

  /**
   * Number of entries currently in the cache.
   * @returns {number}
   */
  get size() {
    return this._map.size;
  }

  /**
   * Iterate over entries in insertion order (oldest first).
   */
  [Symbol.iterator]() {
    return this._map[Symbol.iterator]();
  }

  /**
   * Iterate over entries.
   */
  entries() {
    return this._map.entries();
  }

  /**
   * Iterate over keys.
   */
  keys() {
    return this._map.keys();
  }

  /**
   * Iterate over values.
   */
  values() {
    return this._map.values();
  }

  /**
   * Execute a callback for each entry.
   */
  forEach(callback) {
    this._map.forEach(callback);
  }

  /**
   * Find all values matching a predicate.
   * @param {Function} predicate - (value, key) => boolean
   * @returns {Array} Matching values
   */
  filter(predicate) {
    const results = [];
    for (const [key, value] of this._map) {
      if (predicate(value, key)) {
        results.push(value);
      }
    }
    return results;
  }

  /**
   * Convert to plain array of values.
   * @returns {Array}
   */
  toArray() {
    return Array.from(this._map.values());
  }
}

module.exports = LRUMap;
