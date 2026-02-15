/**
 * Tests for src/services/auditLogger.js
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

const AuditLogger = require('../../src/services/auditLogger');

describe('AuditLogger', () => {
  let auditLogger;

  beforeEach(() => {
    vi.clearAllMocks();
    auditLogger = new AuditLogger();
  });

  // ── constructor ──────────────────────────────────────────────

  describe('constructor', () => {
    it('initializes with empty log array', () => {
      expect(auditLogger.logs).toEqual([]);
      expect(auditLogger.logs.length).toBe(0);
    });

    it('sets enabled to true by default', () => {
      expect(auditLogger.config.enabled).toBe(true);
    });

    it('sets default retention days', () => {
      expect(auditLogger.config.retentionDays).toBe(90);
    });

    it('accepts custom config', () => {
      const custom = new AuditLogger({ retentionDays: 30, logLevel: 'warn' });
      expect(custom.config.retentionDays).toBe(30);
      expect(custom.config.logLevel).toBe('warn');
    });
  });

  // ── log ──────────────────────────────────────────────────────

  describe('log', () => {
    it('creates an entry with timestamp', () => {
      auditLogger.log('ORDER_CREATED', { userId: 'user-1' });
      expect(auditLogger.logs.length).toBe(1);
      expect(auditLogger.logs[0].timestamp).toBeDefined();
      expect(auditLogger.logs[0].timestamp).toBeGreaterThan(0);
    });

    it('stores the entry in logs array', () => {
      auditLogger.log('ORDER_CREATED', { userId: 'user-1' });
      expect(auditLogger.logs.length).toBe(1);
      expect(auditLogger.logs[0].eventType).toBe('ORDER_CREATED');
    });

    it('generates a unique ID for each entry', () => {
      auditLogger.log('EVENT_A', { userId: 'user-1' });
      auditLogger.log('EVENT_B', { userId: 'user-1' });
      expect(auditLogger.logs[0].id).not.toBe(auditLogger.logs[1].id);
      expect(auditLogger.logs[0].id).toMatch(/^audit_/);
    });

    it('tracks different event types', () => {
      auditLogger.log('ORDER_CREATED', { userId: 'user-1' });
      auditLogger.log('ORDER_FILLED', { userId: 'user-1' });
      auditLogger.log('ERROR', { userId: 'user-1' });

      const types = auditLogger.logs.map(l => l.eventType);
      expect(types).toContain('ORDER_CREATED');
      expect(types).toContain('ORDER_FILLED');
      expect(types).toContain('ERROR');
    });

    it('defaults level to info', () => {
      auditLogger.log('TEST', { userId: 'user-1' });
      expect(auditLogger.logs[0].level).toBe('info');
    });

    it('accepts custom log level', () => {
      auditLogger.log('ERROR', { userId: 'user-1' }, 'error');
      expect(auditLogger.logs[0].level).toBe('error');
    });

    it('does not log when disabled', () => {
      const disabled = new AuditLogger({ enabled: false });
      disabled.log('TEST', { userId: 'user-1' });
      expect(disabled.logs.length).toBe(0);
    });

    it('sanitizes data before storing', () => {
      auditLogger.log('SECURITY', { userId: 'user-1', apiKey: 'secret-key-123' });
      expect(auditLogger.logs[0].data.apiKey).toBe('[REDACTED]');
    });

    it('includes metadata with node info', () => {
      auditLogger.log('TEST', { userId: 'user-1' });
      expect(auditLogger.logs[0].metadata).toBeDefined();
      expect(auditLogger.logs[0].metadata.nodeVersion).toBe(process.version);
      expect(auditLogger.logs[0].metadata.platform).toBe(process.platform);
    });

    it('handles trade events', () => {
      auditLogger.log('ORDER_CREATED', {
        userId: 'user-1',
        order: { pair: 'BTC/USD', side: 'buy', amount: 0.5 }
      });
      expect(auditLogger.logs[0].eventType).toBe('ORDER_CREATED');
      expect(auditLogger.logs[0].data.order).toBeDefined();
    });

    it('handles auth events', () => {
      auditLogger.logSecurity('LOGIN', {
        userId: 'user-1',
        ip: '127.0.0.1',
        userAgent: 'TestAgent'
      });
      expect(auditLogger.logs[0].eventType).toBe('SECURITY_LOGIN');
      expect(auditLogger.logs[0].level).toBe('warn');
    });

    it('handles error events', () => {
      auditLogger.logError('createOrder', new Error('Failed'), { userId: 'user-1' });
      expect(auditLogger.logs[0].eventType).toBe('ERROR');
      expect(auditLogger.logs[0].level).toBe('error');
      expect(auditLogger.logs[0].data.error.message).toBe('Failed');
    });

    it('trims logs when exceeding maxLogs', () => {
      auditLogger.maxLogs = 5;
      for (let i = 0; i < 7; i++) {
        auditLogger.log(`EVENT_${i}`, { userId: 'user-1' });
      }
      expect(auditLogger.logs.length).toBe(5);
    });
  });

  // ── query ────────────────────────────────────────────────────

  describe('query', () => {
    beforeEach(() => {
      auditLogger.logs = [
        { id: 'l1', eventType: 'ORDER_CREATED', level: 'info', timestamp: Date.now() - 5000, data: { userId: 'user-1' } },
        { id: 'l2', eventType: 'ORDER_FILLED', level: 'info', timestamp: Date.now() - 3000, data: { userId: 'user-1' } },
        { id: 'l3', eventType: 'ERROR', level: 'error', timestamp: Date.now() - 1000, data: { userId: 'user-2' } },
        { id: 'l4', eventType: 'SIGNAL_BLOCKED', level: 'warn', timestamp: Date.now(), data: { userId: 'user-1' } }
      ];
    });

    it('returns all entries when no filters', () => {
      const results = auditLogger.query();
      expect(results.length).toBe(4);
    });

    it('filters by eventType', () => {
      const results = auditLogger.query({ eventType: 'ORDER_CREATED' });
      expect(results.length).toBe(1);
      expect(results[0].eventType).toBe('ORDER_CREATED');
    });

    it('filters by userId', () => {
      const results = auditLogger.query({ userId: 'user-1' });
      expect(results.length).toBe(3);
    });

    it('filters by level', () => {
      const results = auditLogger.query({ level: 'error' });
      expect(results.length).toBe(1);
      expect(results[0].level).toBe('error');
    });

    it('filters by date range (since)', () => {
      const results = auditLogger.query({ since: Date.now() - 2000 });
      expect(results.length).toBe(2);
    });

    it('filters by date range (until)', () => {
      const results = auditLogger.query({ until: Date.now() - 2000 });
      expect(results.length).toBe(2);
    });

    it('paginates with limit', () => {
      const results = auditLogger.query({ limit: 2 });
      expect(results.length).toBe(2);
    });

    it('returns empty for no matches', () => {
      const results = auditLogger.query({ eventType: 'NONEXISTENT' });
      expect(results).toEqual([]);
    });

    it('sorts by timestamp descending', () => {
      const results = auditLogger.query();
      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i].timestamp).toBeGreaterThanOrEqual(results[i + 1].timestamp);
      }
    });
  });

  // ── getStats ─────────────────────────────────────────────────

  describe('getStats', () => {
    beforeEach(() => {
      auditLogger.logs = [
        { id: 'l1', eventType: 'ORDER_CREATED', level: 'info', timestamp: Date.now(), data: { userId: 'user-1' } },
        { id: 'l2', eventType: 'ORDER_CREATED', level: 'info', timestamp: Date.now(), data: { userId: 'user-1' } },
        { id: 'l3', eventType: 'ERROR', level: 'error', timestamp: Date.now(), data: { userId: 'user-2' } },
        { id: 'l4', eventType: 'SIGNAL_BLOCKED', level: 'warn', timestamp: Date.now(), data: { userId: 'user-1' } }
      ];
    });

    it('counts total logs', () => {
      const stats = auditLogger.getStats();
      expect(stats.totalLogs).toBe(4);
    });

    it('counts by level', () => {
      const stats = auditLogger.getStats();
      expect(stats.byLevel.info).toBe(2);
      expect(stats.byLevel.error).toBe(1);
      expect(stats.byLevel.warn).toBe(1);
    });

    it('groups by event type', () => {
      const stats = auditLogger.getStats();
      expect(stats.byEventType.ORDER_CREATED).toBe(2);
      expect(stats.byEventType.ERROR).toBe(1);
    });

    it('filters by userId', () => {
      const stats = auditLogger.getStats('user-1');
      expect(stats.totalLogs).toBe(3);
    });

    it('includes lastHour and lastDay counts', () => {
      const stats = auditLogger.getStats();
      expect(stats.lastHour).toBe(4);
      expect(stats.lastDay).toBe(4);
    });
  });

  // ── sanitizeData ─────────────────────────────────────────────

  describe('sanitizeData', () => {
    it('redacts sensitive fields', () => {
      const sanitized = auditLogger.sanitizeData({
        userId: 'user-1',
        password: 'hunter2',
        apiKey: 'abc123',
        apiSecret: 'secret',
        token: 'tok123',
        privateKey: 'pk'
      });

      expect(sanitized.userId).toBe('user-1');
      expect(sanitized.password).toBe('[REDACTED]');
      expect(sanitized.apiKey).toBe('[REDACTED]');
      expect(sanitized.apiSecret).toBe('[REDACTED]');
      expect(sanitized.token).toBe('[REDACTED]');
      expect(sanitized.privateKey).toBe('[REDACTED]');
    });

    it('handles null/undefined data', () => {
      expect(auditLogger.sanitizeData(null)).toBeNull();
      expect(auditLogger.sanitizeData(undefined)).toBeUndefined();
    });

    it('recursively sanitizes nested objects', () => {
      const sanitized = auditLogger.sanitizeData({
        exchange: { name: 'kraken', apiKey: 'secret' }
      });
      expect(sanitized.exchange.apiKey).toBe('[REDACTED]');
      expect(sanitized.exchange.name).toBe('kraken');
    });
  });

  // ── clearOldLogs ─────────────────────────────────────────────

  describe('clearOldLogs', () => {
    it('removes entries older than retention period', () => {
      auditLogger.logs = [
        { id: 'old', timestamp: Date.now() - 100 * 86400000, data: {} },
        { id: 'new', timestamp: Date.now(), data: {} }
      ];

      const cleared = auditLogger.clearOldLogs();
      expect(cleared).toBe(1);
      expect(auditLogger.logs.length).toBe(1);
      expect(auditLogger.logs[0].id).toBe('new');
    });

    it('accepts custom retention period', () => {
      auditLogger.logs = [
        { id: 'old', timestamp: Date.now() - 5000, data: {} },
        { id: 'new', timestamp: Date.now(), data: {} }
      ];

      const cleared = auditLogger.clearOldLogs(3000);
      expect(cleared).toBe(1);
    });

    it('returns 0 when nothing to clear', () => {
      auditLogger.logs = [{ id: 'new', timestamp: Date.now(), data: {} }];
      const cleared = auditLogger.clearOldLogs();
      expect(cleared).toBe(0);
    });
  });

  // ── clear ────────────────────────────────────────────────────

  describe('clear', () => {
    it('removes all logs and returns count', () => {
      auditLogger.logs = [
        { id: 'a', data: {} },
        { id: 'b', data: {} }
      ];

      const count = auditLogger.clear();
      expect(count).toBe(2);
      expect(auditLogger.logs.length).toBe(0);
    });
  });

  // ── export ───────────────────────────────────────────────────

  describe('export', () => {
    it('returns valid JSON string', () => {
      auditLogger.logs = [
        { id: 'l1', eventType: 'TEST', level: 'info', timestamp: Date.now(), data: { userId: 'user-1' } }
      ];

      const exported = auditLogger.export();
      const parsed = JSON.parse(exported);

      expect(parsed.count).toBe(1);
      expect(parsed.logs).toBeDefined();
      expect(parsed.exportedAt).toBeDefined();
    });
  });
});
