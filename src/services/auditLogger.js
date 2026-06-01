const crypto = require('crypto');
const logger = require('../utils/logger');
const eventBus = require('../utils/eventBus');

/**
 * AuditLogger - Comprehensive audit logging for all trading activities
 * Records every decision, action, and event for compliance and debugging
 */
class AuditLogger {
  constructor(config = {}) {
    this.config = {
      enabled: config.enabled !== false,
      logLevel: config.logLevel || 'info',
      retentionDays: config.retentionDays || 90,
      includeStackTrace: config.includeStackTrace !== false,
      ...config
    };
    
    this.logs = [];
    this.maxLogs = 10000;
    this.subscriptions = []; // Store { event, id } for cleanup
    
    this.setupEventHandlers();
  }

  /**
   * Setup event handlers
   */
  setupEventHandlers() {
    // Subscribe to all trading events
    this.subscriptions.push({
      event: 'trading:orderCreated',
      id: eventBus.subscribe('trading:orderCreated', (data) => {
        this.log('ORDER_CREATED', data);
      })
    });
    
    this.subscriptions.push({
      event: 'trading:orderFilled',
      id: eventBus.subscribe('trading:orderFilled', (data) => {
        this.log('ORDER_FILLED', data);
      })
    });
    
    this.subscriptions.push({
      event: 'trading:orderCancelled',
      id: eventBus.subscribe('trading:orderCancelled', (data) => {
        this.log('ORDER_CANCELLED', data);
      })
    });
    
    this.subscriptions.push({
      event: 'trading:orderRejected',
      id: eventBus.subscribe('trading:orderRejected', (data) => {
        this.log('ORDER_REJECTED', data, 'warn');
      })
    });
    
    this.subscriptions.push({
      event: 'trading:strategySignal',
      id: eventBus.subscribe('trading:strategySignal', (data) => {
        this.log('STRATEGY_SIGNAL', data);
      })
    });
    
    this.subscriptions.push({
      event: 'trading:signalBlocked',
      id: eventBus.subscribe('trading:signalBlocked', (data) => {
        this.log('SIGNAL_BLOCKED', data, 'warn');
      })
    });
    
    this.subscriptions.push({
      event: 'risk:circuitBreakerTriggered',
      id: eventBus.subscribe('risk:circuitBreakerTriggered', (data) => {
        this.log('CIRCUIT_BREAKER_TRIGGERED', data, 'error');
      })
    });
    
    this.subscriptions.push({
      event: 'risk:circuitBreakerReset',
      id: eventBus.subscribe('risk:circuitBreakerReset', (data) => {
        this.log('CIRCUIT_BREAKER_RESET', data);
      })
    });
    
    this.subscriptions.push({
      event: 'risk:checkFailed',
      id: eventBus.subscribe('risk:checkFailed', (data) => {
        this.log('RISK_CHECK_FAILED', data, 'warn');
      })
    });
    
    this.subscriptions.push({
      event: 'alert:sent',
      id: eventBus.subscribe('alert:sent', (data) => {
        this.log('ALERT_SENT', data);
      })
    });
  }

  /**
   * Log an event
   * @param {string} eventType - Type of event
   * @param {Object} data - Event data
   * @param {string} level - Log level
   */
  log(eventType, data, level = 'info') {
    if (!this.config.enabled) return;
    
    const entry = {
      id: `audit_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      timestamp: Date.now(),
      eventType,
      level,
      data: this.sanitizeData(data),
      metadata: {
        nodeVersion: process.version,
        platform: process.platform,
        memory: process.memoryUsage()
      }
    };
    
    this.logs.push(entry);
    
    // Trim logs if too many
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
    
    // Also log to winston (use sanitized data to prevent leaking secrets)
    const sanitizedData = this.sanitizeData(data);
    const message = `[AUDIT] ${eventType}: ${this.formatMessage(sanitizedData)}`;
    switch (level) {
      case 'error':
        logger.error(message, sanitizedData);
        break;
      case 'warn':
        logger.warn(message, sanitizedData);
        break;
      default:
        logger.info(message, sanitizedData);
    }
  }

  /**
   * Log a trade decision with full context
   * @param {Object} context - Decision context
   */
  logTradeDecision(context) {
    this.log('TRADE_DECISION', {
      userId: context.userId,
      strategyId: context.strategyId,
      decision: context.decision,
      inputs: {
        marketData: context.marketData,
        portfolio: context.portfolio,
        signals: context.signals
      },
      outputs: {
        action: context.action,
        order: context.order,
        riskCheck: context.riskCheck
      },
      reasoning: context.reasoning,
      timestamp: Date.now()
    });
  }

  /**
   * Log an error with full context
   * @param {string} operation - Operation that failed
   * @param {Error} error - Error object
   * @param {Object} context - Error context
   */
  logError(operation, error, context = {}) {
    const data = {
      operation,
      error: {
        message: error.message,
        code: error.code,
        stack: this.config.includeStackTrace ? error.stack : undefined
      },
      context
    };
    
    this.log('ERROR', data, 'error');
  }

  /**
   * Log a security event
   * @param {string} event - Security event type
   * @param {Object} data - Event data
   */
  logSecurity(event, data) {
    this.log(`SECURITY_${event}`, {
      ...data,
      ip: data.ip,
      userAgent: data.userAgent,
      timestamp: Date.now()
    }, 'warn');
  }

  /**
   * Sanitize sensitive data
   * @param {Object} data - Data to sanitize
   */
  sanitizeData(data) {
    if (!data || typeof data !== 'object') return data;
    
    // Handle arrays - sanitize each element
    if (Array.isArray(data)) {
      return data.map(item => this.sanitizeData(item));
    }
    
    const sanitized = { ...data };
    
    // Remove sensitive fields
    const sensitiveFields = ['password', 'apiKey', 'apiSecret', 'token', 'privateKey', 'secret'];
    
    for (const field of sensitiveFields) {
      if (field in sanitized) {
        sanitized[field] = '[REDACTED]';
      }
    }
    
    // Recursively sanitize nested objects
    for (const key of Object.keys(sanitized)) {
      if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
        sanitized[key] = this.sanitizeData(sanitized[key]);
      }
    }
    
    return sanitized;
  }

  /**
   * Format log message
   * @param {Object} data - Log data
   */
  formatMessage(data) {
    if (data.userId) {
      return `User: ${data.userId}`;
    }
    if (data.order?.userId) {
      return `User: ${data.order.userId}`;
    }
    return 'System';
  }

  /**
   * Query audit logs
   * @param {Object} filters - Query filters
   */
  query(filters = {}) {
    let results = [...this.logs];
    
    if (filters.eventType) {
      results = results.filter(l => l.eventType === filters.eventType);
    }
    
    if (filters.level) {
      results = results.filter(l => l.level === filters.level);
    }
    
    if (filters.userId) {
      results = results.filter(l => {
        const data = l.data || {};
        return data.userId === filters.userId ||
               data.order?.userId === filters.userId ||
               data.signal?.userId === filters.userId;
      });
    }
    
    if (filters.since) {
      results = results.filter(l => l.timestamp >= filters.since);
    }
    
    if (filters.until) {
      results = results.filter(l => l.timestamp <= filters.until);
    }
    
    // Sort by timestamp descending
    results.sort((a, b) => b.timestamp - a.timestamp);
    
    if (filters.limit) {
      results = results.slice(0, filters.limit);
    }
    
    return results;
  }

  /**
   * Get audit statistics
   * @param {string} userId - Optional user filter
   */
  getStats(userId = null) {
    let logs = this.logs;
    
    if (userId) {
      logs = logs.filter(l => {
        const data = l.data || {};
        return data.userId === userId || data.order?.userId === userId;
      });
    }
    
    const now = Date.now();
    const dayAgo = now - 86400000;
    const hourAgo = now - 3600000;
    
    return {
      totalLogs: logs.length,
      lastHour: logs.filter(l => l.timestamp > hourAgo).length,
      lastDay: logs.filter(l => l.timestamp > dayAgo).length,
      byLevel: {
        info: logs.filter(l => l.level === 'info').length,
        warn: logs.filter(l => l.level === 'warn').length,
        error: logs.filter(l => l.level === 'error').length
      },
      byEventType: this.groupByEventType(logs)
    };
  }

  /**
   * Group logs by event type
   * @param {Array} logs - Log entries
   */
  groupByEventType(logs) {
    const groups = {};
    
    for (const log of logs) {
      if (!groups[log.eventType]) {
        groups[log.eventType] = 0;
      }
      groups[log.eventType]++;
    }
    
    return groups;
  }

  /**
   * Export logs to JSON
   * @param {Object} filters - Export filters
   */
  export(filters = {}) {
    const logs = this.query(filters);
    
    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      count: logs.length,
      filters,
      logs
    }, null, 2);
  }

  /**
   * Clear old logs
   * @param {number} olderThan - Clear logs older than this (ms)
   */
  clearOldLogs(olderThan = null) {
    const retention = olderThan || (this.config.retentionDays * 24 * 60 * 60 * 1000);
    const cutoff = Date.now() - retention;
    const beforeCount = this.logs.length;
    
    this.logs = this.logs.filter(l => l.timestamp > cutoff);
    
    const cleared = beforeCount - this.logs.length;
    if (cleared > 0) {
      logger.info(`Cleared ${cleared} old audit logs`);
    }
    
    return cleared;
  }

  /**
   * Clear all logs
   */
  clear() {
    const count = this.logs.length;
    this.logs = [];
    logger.info(`Cleared all ${count} audit logs`);
    return count;
  }

  /**
   * Shutdown: remove event subscriptions to prevent memory leaks
   */
  shutdown() {
    for (const sub of this.subscriptions) {
      eventBus.unsubscribe(sub.event, sub.id);
    }
    this.subscriptions = [];
    logger.info('AuditLogger shutdown complete');
  }
}

module.exports = AuditLogger;
