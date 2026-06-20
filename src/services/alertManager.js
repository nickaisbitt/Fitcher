const logger = require('../utils/logger');
const eventBus = require('../utils/eventBus');
const { isSafeWebhookUrl } = require('../utils/urlValidator');

/**
 * AlertManager - Manages trading alerts and notifications
 * Monitors conditions and sends alerts when thresholds are breached
 */
class AlertManager {
  constructor(config = {}) {
    this.config = {
      enabled: config.enabled !== false,
      defaultCooldown: config.defaultCooldown || 300000, // 5 minutes
      maxAlertsPerHour: config.maxAlertsPerHour || 20,
      ...config
    };
    
    this.alerts = new Map(); // alertId -> alert config
    this.alertHistory = []; // Recent alerts
    this.userAlerts = new Map(); // userId -> Set of alertIds
    this.lastAlertTime = new Map(); // alertKey -> timestamp
    this.subscriptions = []; // Store { event, id } for cleanup
    
    this.setupEventHandlers();
  }

  /**
   * Setup event handlers
   */
  setupEventHandlers() {
    // Listen for events that might trigger alerts
    this.subscriptions.push({
      event: 'risk:circuitBreakerTriggered',
      id: eventBus.subscribe('risk:circuitBreakerTriggered', (data) => {
        this.sendAlert('circuit_breaker', {
          userId: data.userId,
          severity: 'critical',
          message: `Circuit breaker triggered for user ${data.userId}`,
          data
        });
      })
    });
    
    this.subscriptions.push({
      event: 'trading:orderFilled',
      id: eventBus.subscribe('trading:orderFilled', (data) => {
        const { order } = data;
        
        // Alert on large trades
        const tradeValue = (order.filledAmount || 0) * (order.averagePrice || 0);
        if (tradeValue > 50000) {
          this.sendAlert('large_trade', {
            userId: order.userId,
            severity: 'info',
            message: `Large trade executed: $${tradeValue.toFixed(2)}`,
            data: { order, value: tradeValue }
          });
        }
        
        // Alert on significant PnL
        if (order.realizedPnL) {
          if (order.realizedPnL > 1000) {
            this.sendAlert('profit', {
              userId: order.userId,
              severity: 'success',
              message: `Significant profit: $${order.realizedPnL.toFixed(2)}`,
              data: { order }
            });
          } else if (order.realizedPnL < -1000) {
            this.sendAlert('loss', {
              userId: order.userId,
              severity: 'warning',
              message: `Significant loss: $${order.realizedPnL.toFixed(2)}`,
              data: { order }
            });
          }
        }
      })
    });
    
    this.subscriptions.push({
      event: 'trading:signalBlocked',
      id: eventBus.subscribe('trading:signalBlocked', (data) => {
        this.sendAlert('signal_blocked', {
          userId: data.signal?.userId,
          severity: 'warning',
          message: 'Strategy signal blocked by risk manager',
          data
        });
      })
    });
  }

  /**
   * Create a new alert
   * @param {string} userId - User ID
   * @param {Object} config - Alert configuration
   */
  createAlert(userId, config) {
    const alertId = `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const alert = {
      id: alertId,
      userId,
      type: config.type,
      name: config.name,
      condition: config.condition,
      severity: config.severity || 'info',
      message: config.message,
      channels: config.channels || ['in_app'],
      cooldown: config.cooldown || this.config.defaultCooldown,
      enabled: true,
      createdAt: Date.now()
    };
    
    this.alerts.set(alertId, alert);
    
    if (!this.userAlerts.has(userId)) {
      this.userAlerts.set(userId, new Set());
    }
    this.userAlerts.get(userId).add(alertId);
    
    logger.info(`Alert created: ${alert.name} for user ${userId}`);
    
    return alert;
  }

  /**
   * Send an alert
   * @param {string} type - Alert type
   * @param {Object} data - Alert data
   */
  sendAlert(type, data) {
    if (!this.config.enabled) return;
    
    const alertKey = `${type}_${data.userId}`;
    const lastTime = this.lastAlertTime.get(alertKey) || 0;
    const now = Date.now();
    
    // Check cooldown
    const cooldown = data.cooldown || this.config.defaultCooldown;
    if (now - lastTime < cooldown) {
      return;
    }
    
    // Check rate limit
    const recentAlerts = this.alertHistory.filter(a => 
      a.userId === data.userId && a.timestamp > now - 3600000
    );
    
    if (recentAlerts.length >= this.config.maxAlertsPerHour) {
      logger.warn(`Alert rate limit exceeded for user ${data.userId}`);
      return;
    }
    
    // Create alert record
    const alert = {
      id: `alert_${now}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      severity: data.severity,
      message: data.message,
      userId: data.userId,
      data: data.data,
      timestamp: now,
      acknowledged: false
    };
    
    this.alertHistory.push(alert);
    this.lastAlertTime.set(alertKey, now);
    
    // Trim history
    if (this.alertHistory.length > 1000) {
      this.alertHistory.shift();
    }
    
    // Log based on severity
    switch (data.severity) {
      case 'critical':
        logger.error(`🚨 ALERT [${type}]: ${data.message}`, data.data);
        break;
      case 'warning':
        logger.warn(`⚠️  ALERT [${type}]: ${data.message}`, data.data);
        break;
      case 'success':
        logger.info(`✅ ALERT [${type}]: ${data.message}`, data.data);
        break;
      default:
        logger.info(`ℹ️  ALERT [${type}]: ${data.message}`, data.data);
    }
    
    // Publish alert event
    eventBus.publish('alert:sent', alert);
    
    // Send through channels
    this.deliverAlert(alert, data.channels);
  }

  /**
   * Deliver alert through configured channels
   * @param {Object} alert - Alert object
   * @param {Array} channels - Delivery channels
   */
  deliverAlert(alert, channels = ['in_app']) {
    for (const channel of channels) {
      switch (channel) {
        case 'in_app':
          // Alert is already stored and will be available via API
          break;
          
        case 'webhook':
          this.sendWebhook(alert);
          break;
          
        case 'email':
          this.sendEmail(alert);
          break;
          
        case 'slack':
          this.sendSlack(alert);
          break;
          
        default:
          logger.warn(`Unknown alert channel: ${channel}`);
      }
    }
  }

  /**
   * Send email alert
   */
  async sendEmail(alert) {
    try {
      const emailConfig = this.config.email;
      if (!emailConfig || !emailConfig.enabled) return;

      const subject = `[${alert.severity.toUpperCase()}] ${alert.type}: ${alert.message.substring(0, 50)}`;
      const body = this.formatEmailBody(alert);

      // For now, save to file (replace with actual email service)
      const fs = require('fs').promises;
      const path = require('path');
      const emailDir = path.join(__dirname, '..', '..', 'data', 'emails');
      await fs.mkdir(emailDir, { recursive: true });
      
      const filename = `email-${Date.now()}.txt`;
      await fs.writeFile(
        path.join(emailDir, filename),
        `To: ${emailConfig.recipients?.join(', ') || 'admin@fitcher.com'}\nSubject: ${subject}\n\n${body}`
      );

      logger.info(`Email alert saved: ${filename}`);
    } catch (error) {
      logger.error('Failed to send email alert:', error);
    }
  }

  /**
   * Format email body
   */
  formatEmailBody(alert) {
    const timestamp = new Date(alert.timestamp).toISOString();
    return `
Fitcher Trading Alert
====================

Time: ${timestamp}
Type: ${alert.type}
Severity: ${alert.severity.toUpperCase()}
User: ${alert.userId}

Message:
${alert.message}

Data:
${JSON.stringify(alert.data, null, 2)}

---
Fitcher Trading System
    `.trim();
  }

  /**
   * Send webhook alert
   */
  async sendWebhook(alert) {
    try {
      const webhookConfig = this.config.webhook;
      if (!webhookConfig || !webhookConfig.enabled || !webhookConfig.url) return;

      if (!isSafeWebhookUrl(webhookConfig.url)) {
        logger.warn(`Blocked unsafe webhook URL: ${webhookConfig.url}`);
        return;
      }

      const response = await fetch(webhookConfig.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(alert)
      });

      if (!response.ok) {
        logger.error(`Webhook delivery failed with status ${response.status}`);
        return;
      }

      logger.info(`Webhook alert sent to ${webhookConfig.url}`);
    } catch (error) {
      logger.error('Failed to send webhook alert:', error);
    }
  }

  /**
   * Send Slack alert
   */
  async sendSlack(alert) {
    // TODO: Implement Slack integration
    logger.debug('Slack delivery not yet implemented');
  }

  /**
   * Get alerts for a user
   * @param {string} userId - User ID
   * @param {Object} filters - Filter options
   */
  getAlerts(userId, filters = {}) {
    let alerts = this.alertHistory.filter(a => a.userId === userId);
    
    if (filters.severity) {
      alerts = alerts.filter(a => a.severity === filters.severity);
    }
    
    if (filters.type) {
      alerts = alerts.filter(a => a.type === filters.type);
    }
    
    if (filters.since) {
      alerts = alerts.filter(a => a.timestamp >= filters.since);
    }
    
    if (filters.unacknowledged) {
      alerts = alerts.filter(a => !a.acknowledged);
    }
    
    // Sort by timestamp descending
    alerts.sort((a, b) => b.timestamp - a.timestamp);
    
    if (filters.limit) {
      alerts = alerts.slice(0, filters.limit);
    }
    
    return alerts;
  }

  /**
   * Acknowledge an alert
   * @param {string} alertId - Alert ID
   * @param {string} userId - User ID
   */
  acknowledgeAlert(alertId, userId) {
    const alert = this.alertHistory.find(a => a.id === alertId && a.userId === userId);
    
    if (alert) {
      alert.acknowledged = true;
      alert.acknowledgedAt = Date.now();
      logger.info(`Alert ${alertId} acknowledged by user ${userId}`);
      return true;
    }
    
    return false;
  }

  /**
   * Get alert statistics
   * @param {string} userId - User ID
   */
  getStats(userId = null) {
    let alerts = this.alertHistory;
    
    if (userId) {
      alerts = alerts.filter(a => a.userId === userId);
    }
    
    const now = Date.now();
    const hourAgo = now - 3600000;
    const dayAgo = now - 86400000;
    
    return {
      total: alerts.length,
      lastHour: alerts.filter(a => a.timestamp > hourAgo).length,
      lastDay: alerts.filter(a => a.timestamp > dayAgo).length,
      bySeverity: {
        critical: alerts.filter(a => a.severity === 'critical').length,
        warning: alerts.filter(a => a.severity === 'warning').length,
        info: alerts.filter(a => a.severity === 'info').length,
        success: alerts.filter(a => a.severity === 'success').length
      },
      unacknowledged: alerts.filter(a => !a.acknowledged).length
    };
  }

  /**
   * Clear old alerts
   * @param {number} olderThan - Clear alerts older than this (ms)
   */
  clearOldAlerts(olderThan = 7 * 24 * 60 * 60 * 1000) { // 7 days default
    const cutoff = Date.now() - olderThan;
    const beforeCount = this.alertHistory.length;
    
    this.alertHistory = this.alertHistory.filter(a => a.timestamp > cutoff);
    
    const cleared = beforeCount - this.alertHistory.length;
    if (cleared > 0) {
      logger.info(`Cleared ${cleared} old alerts`);
    }
    
    return cleared;
  }

  /**
   * Enable/disable alerts
   * @param {boolean} enabled - Enable state
   */
  setEnabled(enabled) {
    this.config.enabled = enabled;
    logger.info(`Alerts ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Shutdown: remove event subscriptions to prevent memory leaks
   */
  shutdown() {
    for (const sub of this.subscriptions) {
      eventBus.unsubscribe(sub.event, sub.id);
    }
    this.subscriptions = [];
    logger.info('AlertManager shutdown complete');
  }
}

module.exports = AlertManager;
