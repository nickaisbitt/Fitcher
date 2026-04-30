/**
 * Tests for src/services/alertManager.js
 */

const redis = require('../../src/utils/redis');
const logger = require('../../src/utils/logger');

// Mock redis via spyOn
vi.spyOn(redis, 'get').mockResolvedValue(null);
vi.spyOn(redis, 'set').mockResolvedValue('OK');
vi.spyOn(redis, 'del').mockResolvedValue(1);
vi.spyOn(redis, 'connect').mockResolvedValue(undefined);
vi.spyOn(redis, 'disconnect').mockResolvedValue(undefined);

// Mock logger to prevent output
vi.spyOn(logger, 'info').mockImplementation(() => {});
vi.spyOn(logger, 'warn').mockImplementation(() => {});
vi.spyOn(logger, 'error').mockImplementation(() => {});
vi.spyOn(logger, 'debug').mockImplementation(() => {});

// Mock eventBus to prevent side effects from constructor
const eventBus = require('../../src/utils/eventBus');
vi.spyOn(eventBus, 'subscribe').mockImplementation(() => 'sub-id');
vi.spyOn(eventBus, 'publish').mockImplementation(() => {});

const AlertManager = require('../../src/services/alertManager');

describe('AlertManager', () => {
  let manager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new AlertManager();
  });

  // ── constructor ──────────────────────────────────────────────

  describe('constructor', () => {
    it('sets enabled to true by default', () => {
      expect(manager.config.enabled).toBe(true);
    });

    it('sets defaultCooldown to 300000 by default', () => {
      expect(manager.config.defaultCooldown).toBe(300000);
    });

    it('sets maxAlertsPerHour to 20 by default', () => {
      expect(manager.config.maxAlertsPerHour).toBe(20);
    });

    it('accepts custom config values', () => {
      const custom = new AlertManager({ defaultCooldown: 60000, maxAlertsPerHour: 5 });
      expect(custom.config.defaultCooldown).toBe(60000);
      expect(custom.config.maxAlertsPerHour).toBe(5);
    });

    it('initializes empty alerts map', () => {
      expect(manager.alerts.size).toBe(0);
    });
  });

  // ── createAlert ──────────────────────────────────────────────

  describe('createAlert', () => {
    it('creates an alert with correct properties', () => {
      const alert = manager.createAlert('user-1', {
        type: 'price_above',
        name: 'BTC above 60k',
        condition: { pair: 'BTC/USD', threshold: 60000 },
        severity: 'warning',
        message: 'BTC exceeded 60k'
      });

      expect(alert.userId).toBe('user-1');
      expect(alert.type).toBe('price_above');
      expect(alert.name).toBe('BTC above 60k');
      expect(alert.severity).toBe('warning');
      expect(alert.enabled).toBe(true);
      expect(alert.createdAt).toBeGreaterThan(0);
    });

    it('generates a unique ID', () => {
      const a1 = manager.createAlert('user-1', { type: 'price_above', name: 'A' });
      const a2 = manager.createAlert('user-1', { type: 'price_above', name: 'B' });
      expect(a1.id).not.toBe(a2.id);
      expect(a1.id).toMatch(/^alert_/);
    });

    it('stores the alert in the alerts map', () => {
      const alert = manager.createAlert('user-1', { type: 'test', name: 'Test' });
      expect(manager.alerts.has(alert.id)).toBe(true);
      expect(manager.alerts.get(alert.id)).toBe(alert);
    });

    it('defaults severity to info', () => {
      const alert = manager.createAlert('user-1', { type: 'test', name: 'T' });
      expect(alert.severity).toBe('info');
    });

    it('defaults channels to in_app', () => {
      const alert = manager.createAlert('user-1', { type: 'test', name: 'T' });
      expect(alert.channels).toEqual(['in_app']);
    });

    it('uses default cooldown from config', () => {
      const alert = manager.createAlert('user-1', { type: 'test', name: 'T' });
      expect(alert.cooldown).toBe(300000);
    });

    it('tracks user alerts in userAlerts map', () => {
      const alert = manager.createAlert('user-1', { type: 'test', name: 'T' });
      expect(manager.userAlerts.has('user-1')).toBe(true);
      expect(manager.userAlerts.get('user-1').has(alert.id)).toBe(true);
    });
  });

  // ── sendAlert ────────────────────────────────────────────────

  describe('sendAlert', () => {
    it('adds alert to alertHistory', () => {
      manager.sendAlert('test_type', {
        userId: 'user-1',
        severity: 'info',
        message: 'Test message',
        data: {}
      });

      expect(manager.alertHistory.length).toBe(1);
      expect(manager.alertHistory[0].type).toBe('test_type');
      expect(manager.alertHistory[0].userId).toBe('user-1');
    });

    it('does not send when disabled', () => {
      manager.setEnabled(false);
      manager.sendAlert('test_type', { userId: 'user-1', severity: 'info', message: 'x' });
      expect(manager.alertHistory.length).toBe(0);
    });

    it('respects cooldown period', () => {
      manager.sendAlert('test_type', { userId: 'user-1', severity: 'info', message: 'first' });
      manager.sendAlert('test_type', { userId: 'user-1', severity: 'info', message: 'second' });

      // Second alert should be suppressed by cooldown
      expect(manager.alertHistory.length).toBe(1);
    });

    it('publishes alert:sent event via eventBus', () => {
      manager.sendAlert('test_type', { userId: 'user-1', severity: 'info', message: 'x' });
      expect(eventBus.publish).toHaveBeenCalledWith('alert:sent', expect.objectContaining({
        type: 'test_type',
        userId: 'user-1'
      }));
    });

    it('logs critical alerts via logger.error', () => {
      manager.sendAlert('critical_event', {
        userId: 'user-1',
        severity: 'critical',
        message: 'System down'
      });
      expect(logger.error).toHaveBeenCalled();
    });

    it('logs warning alerts via logger.warn', () => {
      manager.sendAlert('warn_event', {
        userId: 'user-1',
        severity: 'warning',
        message: 'Something iffy'
      });
      expect(logger.warn).toHaveBeenCalled();
    });

    it('logs success alerts via logger.info', () => {
      manager.sendAlert('success_event', {
        userId: 'user-1',
        severity: 'success',
        message: 'Big win'
      });
      expect(logger.info).toHaveBeenCalled();
    });

    it('enforces maxAlertsPerHour rate limit', () => {
      const mgr = new AlertManager({ maxAlertsPerHour: 2, defaultCooldown: 0 });

      mgr.sendAlert('type_a', { userId: 'user-1', severity: 'info', message: '1', cooldown: 0 });
      mgr.sendAlert('type_b', { userId: 'user-1', severity: 'info', message: '2', cooldown: 0 });
      mgr.sendAlert('type_c', { userId: 'user-1', severity: 'info', message: '3', cooldown: 0 });

      // Only first 2 should get through
      expect(mgr.alertHistory.length).toBe(2);
    });

    it('trims history when it exceeds 1000 entries', () => {
      const mgr = new AlertManager({ defaultCooldown: 0, maxAlertsPerHour: 99999 });

      // Pre-fill with 1000 entries for a DIFFERENT user to avoid rate limit
      for (let i = 0; i < 1000; i++) {
        mgr.alertHistory.push({
          id: `alert_${i}`,
          type: 'test',
          userId: 'user-old',
          timestamp: Date.now() - 7200000, // 2 hours ago (outside rate limit window)
          acknowledged: false
        });
      }

      // sendAlert should push one and then trim the oldest
      mgr.sendAlert('type_trim', { userId: 'user-2', severity: 'info', message: 'trim', cooldown: 0 });

      expect(mgr.alertHistory.length).toBeLessThanOrEqual(1001);
    });
  });

  // ── sendEmail ────────────────────────────────────────────────

  describe('sendEmail', () => {
    it('uses a secure filename format and writes to email directory', async () => {
      const fs = require('fs').promises;
      const path = require('path');
      vi.spyOn(fs, 'mkdir').mockResolvedValue(undefined);
      const writeFileSpy = vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);

      const mgr = new AlertManager({
        email: { enabled: true, recipients: ['test@example.com'] },
        enabled: true,
        defaultCooldown: 0
      });

      await mgr.sendEmail({
        type: 'test_alert',
        severity: 'critical',
        message: 'A critical issue',
        userId: 'user-1',
        timestamp: Date.now(),
        data: {}
      });

      expect(fs.mkdir).toHaveBeenCalled();
      expect(writeFileSpy).toHaveBeenCalled();

      const [calledPath, calledContent] = writeFileSpy.mock.calls[0];
      const filename = path.basename(calledPath);

      // Check that the filename uses UUID format instead of timestamp
      // Format: email-[UUID].txt
      expect(filename).toMatch(/^email-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.txt$/);
      expect(calledContent).toContain('To: test@example.com');
      expect(calledContent).toContain('Subject: [CRITICAL] test_alert: A critical issue');
    });
  });

  // ── getAlerts ────────────────────────────────────────────────

  describe('getAlerts', () => {
    beforeEach(() => {
      // Manually push alerts to avoid cooldown interference
      manager.alertHistory.push(
        { id: 'a1', type: 'trade', severity: 'info', userId: 'user-1', timestamp: Date.now() - 5000, acknowledged: false },
        { id: 'a2', type: 'risk', severity: 'warning', userId: 'user-1', timestamp: Date.now() - 3000, acknowledged: true },
        { id: 'a3', type: 'trade', severity: 'info', userId: 'user-2', timestamp: Date.now() - 1000, acknowledged: false }
      );
    });

    it('returns alerts for a specific user', () => {
      const alerts = manager.getAlerts('user-1');
      expect(alerts.length).toBe(2);
      expect(alerts.every(a => a.userId === 'user-1')).toBe(true);
    });

    it('filters by severity', () => {
      const alerts = manager.getAlerts('user-1', { severity: 'warning' });
      expect(alerts.length).toBe(1);
      expect(alerts[0].severity).toBe('warning');
    });

    it('filters by type', () => {
      const alerts = manager.getAlerts('user-1', { type: 'trade' });
      expect(alerts.length).toBe(1);
      expect(alerts[0].type).toBe('trade');
    });

    it('filters unacknowledged only', () => {
      const alerts = manager.getAlerts('user-1', { unacknowledged: true });
      expect(alerts.length).toBe(1);
      expect(alerts[0].acknowledged).toBe(false);
    });

    it('returns empty for unknown user', () => {
      const alerts = manager.getAlerts('user-999');
      expect(alerts).toEqual([]);
    });

    it('respects limit', () => {
      const alerts = manager.getAlerts('user-1', { limit: 1 });
      expect(alerts.length).toBe(1);
    });

    it('sorts by timestamp descending', () => {
      const alerts = manager.getAlerts('user-1');
      expect(alerts[0].timestamp).toBeGreaterThanOrEqual(alerts[1].timestamp);
    });
  });

  // ── acknowledgeAlert ─────────────────────────────────────────

  describe('acknowledgeAlert', () => {
    it('marks alert as acknowledged', () => {
      manager.alertHistory.push({
        id: 'alert-ack-1',
        type: 'test',
        userId: 'user-1',
        timestamp: Date.now(),
        acknowledged: false
      });

      const result = manager.acknowledgeAlert('alert-ack-1', 'user-1');
      expect(result).toBe(true);

      const alert = manager.alertHistory.find(a => a.id === 'alert-ack-1');
      expect(alert.acknowledged).toBe(true);
      expect(alert.acknowledgedAt).toBeDefined();
    });

    it('returns false for nonexistent alert', () => {
      const result = manager.acknowledgeAlert('nonexistent', 'user-1');
      expect(result).toBe(false);
    });

    it('returns false when userId does not match', () => {
      manager.alertHistory.push({
        id: 'alert-ack-2',
        type: 'test',
        userId: 'user-1',
        timestamp: Date.now(),
        acknowledged: false
      });

      const result = manager.acknowledgeAlert('alert-ack-2', 'user-2');
      expect(result).toBe(false);
    });
  });

  // ── getStats ─────────────────────────────────────────────────

  describe('getStats', () => {
    beforeEach(() => {
      manager.alertHistory.push(
        { id: 'a1', type: 'trade', severity: 'info', userId: 'user-1', timestamp: Date.now(), acknowledged: false },
        { id: 'a2', type: 'risk', severity: 'warning', userId: 'user-1', timestamp: Date.now(), acknowledged: true },
        { id: 'a3', type: 'error', severity: 'critical', userId: 'user-2', timestamp: Date.now(), acknowledged: false }
      );
    });

    it('returns total count across all users', () => {
      const stats = manager.getStats();
      expect(stats.total).toBe(3);
    });

    it('returns counts by severity', () => {
      const stats = manager.getStats();
      expect(stats.bySeverity.info).toBe(1);
      expect(stats.bySeverity.warning).toBe(1);
      expect(stats.bySeverity.critical).toBe(1);
    });

    it('filters by userId when provided', () => {
      const stats = manager.getStats('user-1');
      expect(stats.total).toBe(2);
    });

    it('counts unacknowledged alerts', () => {
      const stats = manager.getStats();
      expect(stats.unacknowledged).toBe(2);
    });

    it('tracks lastHour and lastDay counts', () => {
      const stats = manager.getStats();
      expect(stats.lastHour).toBe(3);
      expect(stats.lastDay).toBe(3);
    });
  });

  // ── clearOldAlerts ───────────────────────────────────────────

  describe('clearOldAlerts', () => {
    it('removes alerts older than the specified threshold', () => {
      manager.alertHistory.push(
        { id: 'old', timestamp: Date.now() - 10 * 86400000, userId: 'user-1' },
        { id: 'recent', timestamp: Date.now(), userId: 'user-1' }
      );

      const cleared = manager.clearOldAlerts(7 * 86400000);
      expect(cleared).toBe(1);
      expect(manager.alertHistory.length).toBe(1);
      expect(manager.alertHistory[0].id).toBe('recent');
    });

    it('returns 0 when no old alerts exist', () => {
      manager.alertHistory.push({ id: 'new', timestamp: Date.now(), userId: 'user-1' });
      const cleared = manager.clearOldAlerts();
      expect(cleared).toBe(0);
    });
  });

  // ── setEnabled ───────────────────────────────────────────────

  describe('setEnabled', () => {
    it('disables alerts', () => {
      manager.setEnabled(false);
      expect(manager.config.enabled).toBe(false);
    });

    it('re-enables alerts', () => {
      manager.setEnabled(false);
      manager.setEnabled(true);
      expect(manager.config.enabled).toBe(true);
    });

    it('stops sendAlert from sending when disabled', () => {
      manager.setEnabled(false);
      manager.sendAlert('test', { userId: 'user-1', severity: 'info', message: 'x' });
      expect(manager.alertHistory.length).toBe(0);
    });
  });

  // ── setupEventHandlers ───────────────────────────────────────

  describe('setupEventHandlers', () => {
    it('subscribes to risk:circuitBreakerTriggered', () => {
      expect(eventBus.subscribe).toHaveBeenCalledWith(
        'risk:circuitBreakerTriggered',
        expect.any(Function)
      );
    });

    it('subscribes to trading:orderFilled', () => {
      expect(eventBus.subscribe).toHaveBeenCalledWith(
        'trading:orderFilled',
        expect.any(Function)
      );
    });

    it('subscribes to trading:signalBlocked', () => {
      expect(eventBus.subscribe).toHaveBeenCalledWith(
        'trading:signalBlocked',
        expect.any(Function)
      );
    });
  });

  // ── multiple alerts for same pair ────────────────────────────

  describe('multiple alerts for same pair', () => {
    it('allows multiple alerts for the same user', () => {
      const a1 = manager.createAlert('user-1', { type: 'price_above', name: 'Alert1', condition: { pair: 'BTC/USD' } });
      const a2 = manager.createAlert('user-1', { type: 'price_below', name: 'Alert2', condition: { pair: 'BTC/USD' } });

      expect(manager.alerts.size).toBe(2);
      expect(manager.userAlerts.get('user-1').size).toBe(2);
      expect(a1.id).not.toBe(a2.id);
    });
  });
});
