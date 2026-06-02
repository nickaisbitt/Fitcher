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
    const allTrades = this.metrics.trades;
    let winningCount = 0;
    let losingCount = 0;
    let totalPnl = 0;
    let totalLatency = 0;
    let count = 0;

    const byPairStats = {};
    const byStrategyStats = {};

    for (let i = 0; i < allTrades.length; i++) {
      const t = allTrades[i];
      if (userId && t.userId !== userId) continue;
      if (since && t.timestamp < since) continue;

      count++;
      const pnl = t.pnl || 0;
      if (pnl > 0) {
        winningCount++;
      } else if (pnl < 0) {
        losingCount++;
      }
      totalPnl += pnl;
      totalLatency += t.latency || 0;

      const pair = t.pair || 'unknown';
      let pairStat = byPairStats[pair];
      if (!pairStat) {
        pairStat = { count: 0, totalPnl: 0, avgPnl: 0 };
        byPairStats[pair] = pairStat;
      }
      pairStat.count++;
      pairStat.totalPnl += pnl;

      const strategy = t.strategyId || 'unknown';
      let strategyStat = byStrategyStats[strategy];
      if (!strategyStat) {
        strategyStat = { count: 0, totalPnl: 0, avgPnl: 0 };
        byStrategyStats[strategy] = strategyStat;
      }
      strategyStat.count++;
      strategyStat.totalPnl += pnl;
    }

    if (count === 0) {
      return {
        total: 0,
        winning: 0,
        losing: 0,
        winRate: 0,
        avgPnl: 0,
        totalPnl: 0,
        avgLatency: 0,
        byPair: {},
        byStrategy: {}
      };
    }

    for (const k in byPairStats) {
      const stat = byPairStats[k];
      stat.avgPnl = stat.totalPnl / stat.count;
    }
    for (const k in byStrategyStats) {
      const stat = byStrategyStats[k];
      stat.avgPnl = stat.totalPnl / stat.count;
    }
    
    return {
      total: count,
      winning: winningCount,
      losing: losingCount,
      winRate: (winningCount / count) * 100,
      avgPnl: totalPnl / count,
      totalPnl,
      avgLatency: totalLatency / count,
      byPair: byPairStats,
      byStrategy: byStrategyStats
    };
  }

  /**
   * Get latency statistics
   * @param {string} type - Latency type
   */
  getLatencyStats(type = null) {
    const latencies = this.metrics.latency;
    
    // Optimization: Single-pass filtering + pre-allocated Float64Array avoids GC overhead and array spreading
    let count = 0;
    for (let i = 0; i < latencies.length; i++) {
      if (!type || latencies[i].type === type) count++;
    }
    
    if (count === 0) {
      return { avg: 0, min: 0, max: 0, p95: 0, p99: 0 };
    }
    
    const values = new Float64Array(count);
    let sum = 0;
    let idx = 0;
    for (let i = 0; i < latencies.length; i++) {
      if (!type || latencies[i].type === type) {
        const val = latencies[i].value;
        values[idx++] = val;
        sum += val;
      }
    }

    values.sort();
    
    return {
      avg: sum / count,
      min: values[0],
      max: values[count - 1],
      p95: values[Math.floor(count * 0.95)],
      p99: values[Math.floor(count * 0.99)]
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
    
    // Optimization: Single-pass grouping avoids O(N^2) overhead from Object.entries().map().reduce()
    for (let i = 0; i < array.length; i++) {
      const item = array[i];
      const value = item[key] || 'unknown';
      const pnl = item.pnl || 0;

      let stat = stats[value];
      if (!stat) {
        stat = { count: 0, totalPnl: 0, avgPnl: 0 };
        stats[value] = stat;
      }

      stat.count++;
      stat.totalPnl += pnl;
    }
    
    for (const k in stats) {
      const stat = stats[k];
      stat.avgPnl = stat.totalPnl / stat.count;
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
