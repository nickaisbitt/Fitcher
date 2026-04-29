import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolve } from 'path';

describe('Config Loader', () => {
  let exitMock;
  let errorMock;
  let warnMock;
  let originalEnv;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    // Save original env
    originalEnv = { ...process.env };

    // Clear out env that config reads so we start fresh
    delete process.env.PORT;
    delete process.env.NODE_ENV;
    delete process.env.REDIS_URL;
    delete process.env.DEFAULT_AI_MODEL;
    delete process.env.JWT_EXPIRES_IN;
    delete process.env.REFRESH_TOKEN_EXPIRES_IN;
    delete process.env.FRONTEND_URL;
    delete process.env.LOG_LEVEL;
    delete process.env.JWT_REFRESH_SECRET;

    // Set required variables
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/fitcher';
    process.env.JWT_SECRET = 'test-secret';

    // Mock process and console
    exitMock = vi.spyOn(process, 'exit').mockImplementation(() => {});
    errorMock = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnMock = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  const loadConfig = async () => {
      return (await import(`../../src/config/index.js`)).default;
  };

  it('should load default configuration when optional env vars are missing', async () => {
    const config = await loadConfig();

    expect(config.PORT).toBe(3000);
    expect(config.NODE_ENV).toBe('development');
    expect(config.REDIS_URL).toBe('redis://localhost:6379');
    expect(config.DEFAULT_AI_MODEL).toBe('anthropic/claude-3.5-sonnet');
    expect(config.JWT_EXPIRES_IN).toBe('24h');
    expect(config.REFRESH_TOKEN_EXPIRES_IN).toBe('7d');
    expect(config.FRONTEND_URL).toBe('http://localhost:3000');
    expect(config.LOG_LEVEL).toBe('info');

    // Required env vars we mocked
    expect(config.DATABASE_URL).toBe('postgresql://user:pass@localhost:5432/fitcher');
    expect(config.JWT_SECRET).toBe('test-secret');

    // No error or exit should be called
    expect(errorMock).not.toHaveBeenCalled();
    expect(exitMock).not.toHaveBeenCalled();
  });

  it('should use provided environment variables over defaults', async () => {
    process.env.PORT = '8080';
    process.env.NODE_ENV = 'production';
    process.env.REDIS_URL = 'redis://prod:6379';

    const config = await loadConfig();

    expect(config.PORT).toBe('8080');
    expect(config.NODE_ENV).toBe('production');
    expect(config.REDIS_URL).toBe('redis://prod:6379');
  });

  it('should exit when required variables are missing in production', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.DATABASE_URL; // Missing required var

    const config = await loadConfig();

    expect(errorMock).toHaveBeenCalledWith('Missing required environment variables:', 'DATABASE_URL');
    expect(exitMock).toHaveBeenCalledWith(1);
  });

  it('should warn but not exit when required variables are missing in development', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.JWT_SECRET; // Missing required var

    const config = await loadConfig();

    expect(errorMock).toHaveBeenCalledWith('Missing required environment variables:', 'JWT_SECRET');
    expect(warnMock).toHaveBeenCalledWith('Running without required environment variables in development mode');
    expect(exitMock).not.toHaveBeenCalled();
  });

  it('should fallback JWT_REFRESH_SECRET to JWT_SECRET if not provided', async () => {
    const config = await loadConfig();

    expect(config.JWT_REFRESH_SECRET).toBe('test-secret');
  });

  it('should use JWT_REFRESH_SECRET if provided', async () => {
    process.env.JWT_REFRESH_SECRET = 'refresh-secret';
    const config = await loadConfig();

    expect(config.JWT_REFRESH_SECRET).toBe('refresh-secret');
  });
});
