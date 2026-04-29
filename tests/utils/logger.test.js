import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import winston from 'winston';

describe('Logger Configuration', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should configure 1 Console transport with "error" level for NODE_ENV="test"', async () => {
    vi.stubEnv('NODE_ENV', 'test');

    const loggerModule = await import('../../src/utils/logger.js');
    const logger = loggerModule.default;

    expect(logger.transports).toHaveLength(1);

    const consoleTransport = logger.transports[0];
    expect(consoleTransport).toBeInstanceOf(winston.transports.Console);
    expect(consoleTransport.level).toBe('error');
  });

  it('should configure 3 transports (2 File, 1 Console) for NODE_ENV="development"', async () => {
    vi.stubEnv('NODE_ENV', 'development');

    const loggerModule = await import('../../src/utils/logger.js');
    const logger = loggerModule.default;

    expect(logger.transports).toHaveLength(3);

    const fileTransports = logger.transports.filter(t => t instanceof winston.transports.File);
    const consoleTransports = logger.transports.filter(t => t instanceof winston.transports.Console);

    expect(fileTransports).toHaveLength(2);
    expect(consoleTransports).toHaveLength(1);

    // Check file names
    const fileNames = fileTransports.map(t => t.filename);
    expect(fileNames.some(name => name.endsWith('error.log'))).toBe(true);
    expect(fileNames.some(name => name.endsWith('combined.log'))).toBe(true);

    // Console transport level should not be 'error' when not in test
    expect(consoleTransports[0].level).toBeUndefined();
  });

  it('should configure 2 File transports and no Console for NODE_ENV="production"', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    const loggerModule = await import('../../src/utils/logger.js');
    const logger = loggerModule.default;

    expect(logger.transports).toHaveLength(2);

    const fileTransports = logger.transports.filter(t => t instanceof winston.transports.File);
    const consoleTransports = logger.transports.filter(t => t instanceof winston.transports.Console);

    expect(fileTransports).toHaveLength(2);
    expect(consoleTransports).toHaveLength(0);
  });
});
