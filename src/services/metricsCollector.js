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
    
    // Trim user equity history
    const cutoff = Date.now() - this.config.retentionPeriod;
    let shiftCount = 0;
    while (shiftCount < history.length && history[shiftCount].timestamp < cutoff) {
      shiftCount++;
    }
    if (shiftCount > 0) {
      history.splice(0, shiftCount);
    }
    
    // Keep max data points
    if (history.length > this.config.maxDataPoints) {
      history.splice(0, history.length - this.config.maxDataPoints);
    }
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
    if (shiftCount > 0) {
      dataArray.splice(0, shiftCount);
    }
    
    if (dataArray.length > this.config.maxDataPoints) {
      dataArray.splice(0, dataArray.length - this.config.maxDataPoints);
    }
  }

  /**
   * Get trade statistics
   * @param {string} userId - Optional user filter
   * @param {number} since - Optional time filter
   */
  getTradeStats(userId = null, since = null) {
    const rawTrades = this.metrics.trades;
    let total = 0;
    let winning = 0;
    let losing = 0;
    let totalPnl = 0;
    let totalLatency = 0;
    const trades = []; // For groupBy
    
    for (let i = 0; i < rawTrades.length; i++) {
      const t = rawTrades[i];
      if (userId && t.userId !== userId) continue;
      if (since && t.timestamp < since) continue;

      trades.push(t);
      total++;

      const pnl = t.pnl || 0;
      totalPnl += pnl;

      if (pnl > 0) {
        winning++;
      } else if (pnl < 0) {
        losing++;
      }

      totalLatency += t.latency || 0;
    }
    
    if (total === 0) {
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
    
    return {
      total,
      winning,
      losing,
      winRate: (winning / total) * 100,
      avgPnl: totalPnl / total,
      totalPnl,
      avgLatency: totalLatency / total,
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
    
    const values = latencies.map(l => l.value).sort((a, b) => a - b);
    
    return {
      avg: values.reduce((a, b) => a + b, 0) / values.length,
      min: values[0],
      max: values[values.length - 1],
      p95: values[Math.floor(values.length * 0.95)],
      p99: values[Math.floor(values.length * 0.99)]
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
    const stats = {};
    
    for (let i = 0; i < array.length; i++) {
      const item = array[i];
      const value = item[key] || 'unknown';
      const pnl = item.pnl || 0;

      if (!stats[value]) {
        stats[value] = { count: 0, totalPnl: 0, avgPnl: 0 };
      }

      const group = stats[value];
      group.count++;
      group.totalPnl += pnl;
    }
    
    for (const key in stats) {
      const group = stats[key];
      if (group.count > 0) {
        group.avgPnl = group.totalPnl / group.count;
      }
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
