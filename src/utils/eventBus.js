const crypto = require('crypto');
const EventEmitter = require('events');
const logger = require('./logger');

/**
 * EventBus — Central event communication system.
 *
 * Single event system (no more dual EventEmitter + custom Map confusion).
 * Uses a subscribers Map for priority-ordered, error-isolated handlers.
 * EventEmitter.emit is used internally only for waitFor() compatibility.
 */
class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100); // Trading systems have many subscribers
    this.subscribers = new Map();
    this.eventHistory = [];
    this.maxHistorySize = 1000;
    this.metrics = {
      eventsPublished: 0,
      eventsHandled: 0,
      errors: 0
    };
  }

  /**
   * Subscribe to an event.
   * @param {string} event - Event name
   * @param {Function} handler - Event handler
   * @param {Object} [options]
   * @param {number} [options.priority=0] - Higher runs first
   * @param {boolean} [options.once=false] - Auto-remove after first call
   * @returns {string} Subscription ID (for unsubscribe)
   */
  subscribe(event, handler, options = {}) {
    const { priority = 0, once = false } = options;

    if (typeof handler !== 'function') {
      throw new Error(`Event handler must be a function, got ${typeof handler}`);
    }

    if (!this.subscribers.has(event)) {
      this.subscribers.set(event, []);
    }

    const subscription = {
      handler,
      priority,
      once,
      id: crypto.randomBytes(4).toString('hex')
    };

    const handlers = this.subscribers.get(event);
    handlers.push(subscription);
    handlers.sort((a, b) => b.priority - a.priority);

    return subscription.id;
  }

  /**
   * Unsubscribe by event name and subscription ID.
   * @param {string} event
   * @param {string} subscriptionId
   * @returns {boolean} true if found and removed
   */
  unsubscribe(event, subscriptionId) {
    if (!this.subscribers.has(event)) return false;

    const handlers = this.subscribers.get(event);
    const index = handlers.findIndex(sub => sub.id === subscriptionId);

    if (index !== -1) {
      handlers.splice(index, 1);
      if (handlers.length === 0) {
        this.subscribers.delete(event);
      }
      return true;
    }

    return false;
  }

  /**
   * Publish an event to all subscribers.
   * Each handler is wrapped in try/catch so one failing handler
   * doesn't prevent others from running.
   *
   * @param {string} event - Event name
   * @param {*} data - Event data
   */
  publish(event, data) {
    this.metrics.eventsPublished++;

    const eventPayload = {
      event,
      data,
      timestamp: Date.now(),
      id: crypto.randomBytes(4).toString('hex')
    };

    // Store in history
    this.addToHistory(eventPayload);

    // Also emit on EventEmitter for waitFor() and .on() compatibility
    this.emit(event, data);

    if (!this.subscribers.has(event)) return;

    const handlers = this.subscribers.get(event);
    const toRemove = [];

    for (const subscription of handlers) {
      try {
        subscription.handler(data, eventPayload);
        this.metrics.eventsHandled++;

        if (subscription.once) {
          toRemove.push(subscription.id);
        }
      } catch (error) {
        this.metrics.errors++;
        logger.error(`Error handling event '${event}':`, error);
      }
    }

    // Remove once handlers
    for (const id of toRemove) {
      this.unsubscribe(event, id);
    }
  }

  /**
   * Add event to capped history.
   */
  addToHistory(eventPayload) {
    this.eventHistory.push(eventPayload);
    while (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }
  }

  /**
   * Get event history, optionally filtered by event name.
   * @param {string|null} event
   * @param {number} limit
   * @returns {Array}
   */
  getHistory(event = null, limit = 100) {
    let history = this.eventHistory;
    if (event) {
      history = history.filter(e => e.event === event);
    }
    return history.slice(-limit);
  }

  /**
   * Wait for a specific event (promise-based).
   * @param {string} event
   * @param {number} timeout - ms
   * @param {Function|null} filter - Optional predicate
   * @returns {Promise<*>}
   */
  waitFor(event, timeout = 5000, filter = null) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off(event, handler);
        reject(new Error(`Timeout waiting for event '${event}'`));
      }, timeout);

      const handler = (data) => {
        if (filter && !filter(data)) return;
        clearTimeout(timer);
        this.off(event, handler);
        resolve(data);
      };

      this.on(event, handler);
    });
  }

  /**
   * Get metrics about the event bus.
   */
  getMetrics() {
    let subscriberCount = 0;
    for (const handlers of this.subscribers.values()) {
      subscriberCount += handlers.length;
    }

    return {
      ...this.metrics,
      subscriberCount,
      eventTypes: Array.from(this.subscribers.keys()),
      historySize: this.eventHistory.length
    };
  }

  /**
   * Clear all subscribers and history.
   */
  clear() {
    this.subscribers.clear();
    this.eventHistory = [];
    this.removeAllListeners();
  }
}

// Singleton
const eventBus = new EventBus();

module.exports = eventBus;
