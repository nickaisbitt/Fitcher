const logger = require('../utils/logger');
const eventBus = require('../utils/eventBus');

/**
 * MetricsCollector - Collects and aggregates trading metrics
 * Provides real-time performance monitoring
 */
class MetricsCollector {
  constructor(config = {}) {
    this.config = {
      retentionPeriod: config.retentionPeriod || 24 * 60 * 60 * 1000, // 24 hours
      maxDataPoints: config.maxDataPoints || 10000,
      ...config
    };
    
    this.metrics = {
      trades: [],
      orders: [],
      signals: [],
      errors: [],
      events: [],
      latency: [],
      equity: new Map() // userId -> equity history
    };
    
    this.counters = {
      tradesTotal: 0,
      tradesSuccessful: 0,
      tradesFailed: 0,
      ordersCreated: 0,
      ordersFilled: 0,
      ordersCancelled: 0,
      signalsGenerated: 0,
      signalsExecuted: 0,
      errorsTotal: 0
    };
    
    this.setupEventHandlers();
  }

  /**
   * Setup event handlers
   */
  setupEventHandlers() {
    // Trade events
    eventBus.subscribe('trading:orderFilled', (data) => {
      this.recordTrade(data);
    });
    
    eventBus.subscribe('trading:orderCreated', (data) => {
      this.counters.ordersCreated++;
    });
    
    eventBus.subscribe('trading:orderCancelled', (data) => {
      this.counters.ordersCancelled++;
    });
    
    // Signal events
    eventBus.subscribe('trading:strategySignal', (data) => {
      this.recordSignal(data);
    });
    
    // Risk events
    eventBus.subscribe('risk:circuitBreakerTriggered', (data) => {
      this.recordEvent('circuitBreaker', data);
    });
    
    eventBus.subscribe('risk:checkFailed', (data) => {
      this.recordEvent('riskCheckFailed', data);
    });
  }

  /**
   * Record a trade
   * @param {Object} data - Trade data
   */
  recordTrade(data) {
    const { order, signal } = data;
    
    this.counters.tradesTotal++;
    
    if (order.status === 'filled') {
      this.counters.tradesSuccessful++;
      this.counters.ordersFilled++;
    } else {
      this.counters.tradesFailed++;
    }
    
    const metric = {
      timestamp: Date.now(),
      type: 'trade',
      userId: order.userId,
      orderId: order.id,
      strategyId: order.strategyId,
      pair: order.pair,
      side: order.side,
      amount: order.filledAmount,
      price: order.averagePrice,
      fee: order.fee,
      pnl: order.realizedPnL,
      latency: order.filledAt - order.createdAt
    };
    
    this.metrics.trades.push(metric);
    this.trimOldData(this.metrics.trades);
    
    // Record latency
    if (metric.latency) {
      this.metrics.latency.push({
        timestamp: metric.timestamp,
        type: 'orderExecution',
        value: metric.latency
      });
    }
  }

  /**
   * Record a signal
   * @param {Object} data - Signal data
   */
  recordSignal(data) {
    this.counters.signalsGenerated++;
    
    if (data.signal?.action !== 'hold') {
      this.counters.signalsExecuted++;
    }
    
    this.metrics.signals.push({
      timestamp: Date.now(),
      type: 'signal',
      userId: data.userId,
      strategyId: data.strategyId,
      action: data.signal?.action,
      pair: data.signal?.pair,
      price: data.signal?.price,
      confidence: data.signal?.confidence,
      reason: data.signal?.reason
    });
    
    this.trimOldData(this.metrics.signals);
  }

  /**
   * Record an error
   * @param {string} type - Error type
   * @param {Error} error - Error object
   * @param {Object} context - Error context
   */
  recordError(type, error, context = {}) {
    this.counters.errorsTotal++;
    
    this.metrics.errors.push({
      timestamp: Date.now(),
      type,
      message: error.message,
      stack: error.stack,
      context
    });
    
    this.trimOldData(this.metrics.errors);
    
    logger.error(`Metric recorded error [${type}]:`, error.message);
  }

  /**
   * Record a generic event
   * @param {string} type - Event type
   * @param {Object} data - Event data
   */
  recordEvent(type, data) {
    this.metrics.events.push({
      timestamp: Date.now(),
      type,
      ...data
    });
    
    this.trimOldData(this.metrics.events);
  }

  /**
   * Record equity update
   * @param {string} userId - User ID
   * @param {number} equity - Current equity
   * @param {Object} breakdown - Equity breakdown
   */
  recordEquity(userId, equity, breakdown = {}) {
    if (!this.metrics.equity.has(userId)) {
      this.metrics.equity.set(userId, []);
    }
    
    const history = this.metrics.equity.get(userId);
    history.push({
      timestamp: Date.now(),
      equity,
      ...breakdown
    });
    
    // Trim user equity history using the optimized method
    this.trimOldData(history);
  }

  /**
   * Trim old data from array
   * @param {Array} dataArray - Data array
   */
  trimOldData(dataArray) {
    const cutoff = Date.now() - this.config.retentionPeriod;
    
    let shiftCount = 0;
    while (shiftCount < dataArray.length && dataArray[shiftCount].timestamp < cutoff) {
      shiftCount++;
    }
    
    if (dataArray.length - shiftCount > this.config.maxDataPoints) {
      shiftCount = dataArray.length - this.config.maxDataPoints;
    }

    if (shiftCount > 0) {
      dataArray.splice(0, shiftCount);
    }
  }

  /**
   * Get trade statistics
   * @param {string} userId - Optional user filter
   * @param {number} since - Optional time filter
   */
  getTradeStats(userId = null, since = null) {
    let trades = this.metrics.trades;
    
    if (userId) {
      trades = trades.filter(t => t.userId === userId);
    }
    
    if (since) {
      trades = trades.filter(t => t.timestamp >= since);
    }
    
    if (trades.length === 0) {
      return {
        total: 0,
        winning: 0,
        losing: 0,
        winRate: 0,
        avgPnl: 0,
        totalPnl: 0,
        avgLatency: 0
      };
    }
    
    let winningCount = 0;
    let losingCount = 0;
    let totalPnl = 0;
    let totalLatency = 0;

    for (const t of trades) {
      const pnl = t.pnl || 0;
      if (pnl > 0) {
        winningCount++;
      } else if (pnl < 0) {
        losingCount++;
      }
      totalPnl += pnl;
      totalLatency += t.latency || 0;
    }
    
    return {
      total: trades.length,
      winning: winningCount,
      losing: losingCount,
      winRate: (winningCount / trades.length) * 100,
      avgPnl: totalPnl / trades.length,
      totalPnl,
      avgLatency: totalLatency / trades.length,
      byPair: this.groupBy(trades, 'pair'),
      byStrategy: this.groupBy(trades, 'strategyId')
    };
  }

  /**
   * Get latency statistics
   * @param {string} type - Latency type
   */
  getLatencyStats(type = null) {
    let latencies = this.metrics.latency;
    
    if (type) {
      latencies = latencies.filter(l => l.type === type);
    }
    
    if (latencies.length === 0) {
      return { avg: 0, min: 0, max: 0, p95: 0, p99: 0 };
    }
    
    const len = latencies.length;
    const values = new Float64Array(len);
    let sum = 0;
    for (let i = 0; i < len; i++) {
      const val = latencies[i].value;
      values[i] = val;
      sum += val;
    }

    values.sort();
    
    return {
      avg: sum / len,
      min: values[0],
      max: values[len - 1],
      p95: values[Math.floor(len * 0.95)],
      p99: values[Math.floor(len * 0.99)]
    };
  }

  /**
   * Get equity curve for user
   * @param {string} userId - User ID
   */
  getEquityCurve(userId) {
    return this.metrics.equity.get(userId) || [];
  }

  /**
   * Get current counters
   */
  getCounters() {
    return { ...this.counters };
  }

  /**
   * Get all metrics summary
   */
  getSummary() {
    return {
      counters: this.getCounters(),
      tradeStats: this.getTradeStats(),
      latencyStats: this.getLatencyStats(),
      errorCount: this.metrics.errors.length,
      signalCount: this.metrics.signals.length,
      retentionPeriod: this.config.retentionPeriod,
      dataPoints: {
        trades: this.metrics.trades.length,
        orders: this.metrics.orders.length,
        signals: this.metrics.signals.length,
        errors: this.metrics.errors.length,
        events: this.metrics.events.length,
        latency: this.metrics.latency.length,
        equityUsers: this.metrics.equity.size
      }
    };
  }

  /**
   * Group array by key
   * @param {Array} array - Array to group
   * @param {string} key - Key to group by
   */
  groupBy(array, key) {
    const groups = {};
    
    for (const item of array) {
      const value = item[key] || 'unknown';
      if (!groups[value]) {
        groups[value] = [];
      }
      groups[value].push(item);
    }
    
    // Calculate stats for each group
    const stats = {};
    for (const [key, items] of Object.entries(groups)) {
      const pnls = items.map(i => i.pnl || 0);
      stats[key] = {
        count: items.length,
        totalPnl: pnls.reduce((a, b) => a + b, 0),
        avgPnl: pnls.reduce((a, b) => a + b, 0) / items.length
      };
    }
    
    return stats;
  }

  /**
   * Reset all metrics
   */
  reset() {
    this.metrics.trades = [];
    this.metrics.orders = [];
    this.metrics.signals = [];
    this.metrics.errors = [];
    this.metrics.events = [];
    this.metrics.latency = [];
    this.metrics.equity.clear();
    
    Object.keys(this.counters).forEach(key => {
      this.counters[key] = 0;
    });
    
    logger.info('Metrics collector reset');
  }
}

module.exports = MetricsCollector;
