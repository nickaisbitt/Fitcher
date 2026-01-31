const EventEmitter = require('events');
const logger = require('../utils/logger');

/**
 * EventBus - Central event communication system
 * Provides decoupled event-driven architecture for the trading system
 */
class EventBus extends EventEmitter {
  constructor() {
    super();
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
   * Subscribe to an event with error handling
   * @param {string} event - Event name
   * @param {Function} handler - Event handler
   * @param {Object} options - Subscription options
   */
  subscribe(event, handler, options = {}) {
    const { priority = 0, once = false } = options;
    
    if (!this.subscribers.has(event)) {
      this.subscribers.set(event, []);
    }
    
    const subscription = {
      handler,
      priority,
      once,
      id: Math.random().toString(36).substr(2, 9)
    };
    
    const handlers = this.subscribers.get(event);
    handlers.push(subscription);
    
    // Sort by priority (higher first)
    handlers.sort((a, b) => b.priority - a.priority);
    
    logger.debug(`Subscribed to event '${event}' with priority ${priority}`);
    
    return subscription.id;
  }

  /**
   * Unsubscribe from an event
   * @param {string} event - Event name
   * @param {string} subscriptionId - Subscription ID
   */
  unsubscribe(event, subscriptionId) {
    if (!this.subscribers.has(event)) return false;
    
    const handlers = this.subscribers.get(event);
    const index = handlers.findIndex(sub => sub.id === subscriptionId);
    
    if (index !== -1) {
      handlers.splice(index, 1);
      logger.debug(`Unsubscribed from event '${event}'`);
      return true;
    }
    
    return false;
  }

  /**
   * Publish an event to all subscribers
   * @param {string} event - Event name
   * @param {*} data - Event data
   * @param {Object} options - Publish options
   */
  async publish(event, data, options = {}) {
    const { async = true, timeout = 5000 } = options;
    
    this.metrics.eventsPublished++;
    
    const eventPayload = {
      event,
      data,
      timestamp: Date.now(),
      id: Math.random().toString(36).substr(2, 9)
    };
    
    // Store in history
    this.addToHistory(eventPayload);
    
    // Emit to EventEmitter for compatibility
    this.emit(event, data);
    
    // Handle subscribers
    if (!this.subscribers.has(event)) return;
    
    const handlers = this.subscribers.get(event);
    const toRemove = [];
    
    for (const subscription of handlers) {
      try {
        if (async) {
          // Execute with timeout
          await Promise.race([
            subscription.handler(data, eventPayload),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Handler timeout')), timeout)
            )
          ]);
        } else {
          subscription.handler(data, eventPayload);
        }
        
        this.metrics.eventsHandled++;
        
        // Mark once handlers for removal
        if (subscription.once) {
          toRemove.push(subscription.id);
        }
      } catch (error) {
        this.metrics.errors++;
        logger.error(`Error handling event '${event}':`, error);
      }
    }
    
    // Remove once handlers
    toRemove.forEach(id => this.unsubscribe(event, id));
  }

  /**
   * Publish synchronously (for critical events)
   * @param {string} event - Event name
   * @param {*} data - Event data
   */
  publishSync(event, data) {
    return this.publish(event, data, { async: false });
  }

  /**
   * Add event to history
   * @param {Object} eventPayload - Event payload
   */
  addToHistory(eventPayload) {
    this.eventHistory.push(eventPayload);
    
    // Trim history if too large
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }
  }

  /**
   * Get event history
   * @param {string} event - Filter by event name
   * @param {number} limit - Maximum number of events
   */
  getHistory(event = null, limit = 100) {
    let history = this.eventHistory;
    
    if (event) {
      history = history.filter(e => e.event === event);
    }
    
    return history.slice(-limit);
  }

  /**
   * Wait for an event
   * @param {string} event - Event name
   * @param {number} timeout - Timeout in ms
   * @param {Function} filter - Optional filter function
   */
  waitFor(event, timeout = 5000, filter = null) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
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
   * Get event bus metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      subscriberCount: Array.from(this.subscribers.values())
        .reduce((sum, handlers) => sum + handlers.length, 0),
      eventTypes: Array.from(this.subscribers.keys()),
      historySize: this.eventHistory.length
    };
  }

  /**
   * Clear all subscribers and history
   */
  clear() {
    this.subscribers.clear();
    this.eventHistory = [];
    this.removeAllListeners();
    logger.info('Event bus cleared');
  }
}

// Create singleton instance
const eventBus = new EventBus();

module.exports = eventBus;
