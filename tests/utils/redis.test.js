const Redis = require('ioredis');
const logger = require('../../src/utils/logger');
let config;
let redisUtil;

describe('Redis Util', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.spyOn(logger, 'info').mockImplementation(() => {});
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    vi.spyOn(logger, 'warn').mockImplementation(() => {});

    vi.spyOn(Redis.prototype, 'on').mockImplementation(function(event, cb) {
      if (event === 'connect') cb();
    });
    vi.spyOn(Redis.prototype, 'once').mockImplementation(function(event, cb) {
      if (event === 'ready') cb();
    });
    vi.spyOn(Redis.prototype, 'removeAllListeners').mockImplementation(() => {});
    vi.spyOn(Redis.prototype, 'quit').mockImplementation(() => Promise.resolve('OK'));
    vi.spyOn(Redis.prototype, 'connect').mockImplementation(() => Promise.resolve());

    vi.resetModules();
    config = require('../../src/config');
    redisUtil = require('../../src/utils/redis');
  });

  afterEach(async () => {
    try {
      await redisUtil.disconnect();
    } catch(e) {}
  });

  describe('Real Mode (ioredis wrapper)', () => {
    let mockClient;

    beforeEach(() => {
      config.REDIS_URL = 'redis://localhost:6379';
    });

    describe('when connected', () => {
      beforeEach(async () => {
        await redisUtil.connect();
        const client = redisUtil.getClient();

        mockClient = {
          get: vi.spyOn(client, 'get').mockImplementation(async () => null),
          setex: vi.spyOn(client, 'setex').mockResolvedValue('OK'),
          del: vi.spyOn(client, 'del').mockResolvedValue(1),
          multi: vi.spyOn(client, 'multi').mockReturnValue({
            incr: vi.fn(),
            expire: vi.fn(),
            exec: vi.fn().mockResolvedValue([[null, 1]])
          }),
        };
      });

      afterEach(() => {
        vi.restoreAllMocks();
      });

      it('should connect successfully', () => {
        expect(logger.info).toHaveBeenCalledWith('Connected to Redis successfully');
        expect(redisUtil.getClient()).toBeInstanceOf(Redis);
      });

      it('should set and get values in real mode', async () => {
        mockClient.get.mockResolvedValueOnce(JSON.stringify({ foo: 'bar' }));

        await redisUtil.set('test-key', { foo: 'bar' }, 3600);
        expect(mockClient.setex).toHaveBeenCalledWith('test-key', 3600, JSON.stringify({ foo: 'bar' }));

        const val = await redisUtil.get('test-key');
        expect(mockClient.get).toHaveBeenCalledWith('test-key');
        expect(val).toEqual({ foo: 'bar' });
      });

      it('should delete values in real mode', async () => {
        await redisUtil.del('test-key');
        expect(mockClient.del).toHaveBeenCalledWith('test-key');
      });

      it('should handle session helpers in real mode', async () => {
        await redisUtil.setSession('session-1', { userId: 123 }, 3600);
        expect(mockClient.setex).toHaveBeenCalledWith('session:session-1', 3600, JSON.stringify({ userId: 123 }));

        await redisUtil.getSession('session-1');
        expect(mockClient.get).toHaveBeenCalledWith('session:session-1');

        await redisUtil.deleteSession('session-1');
        expect(mockClient.del).toHaveBeenCalledWith('session:session-1');
      });

      it('should handle rate limits in real mode', async () => {
        const limit = await redisUtil.incrementRateLimit('limit-key', 60);
        expect(mockClient.multi).toHaveBeenCalled();
        expect(limit).toBe(1);

        mockClient.get.mockResolvedValueOnce('2');
        const count = await redisUtil.getRateLimit('limit-key');
        expect(count).toBe(2);
      });

      it('should get rate limit 0 if missing in real mode', async () => {
        mockClient.get.mockResolvedValueOnce(null);
        const count = await redisUtil.getRateLimit('limit-key');
        expect(count).toBe(0);
      });
    });

    it('should fallback to mock mode on connection error', async () => {
      Redis.prototype.once.mockImplementation(function(event, cb) {
        if (event === 'error') cb(new Error('Connection failed'));
      });

      await redisUtil.connect();

      expect(logger.error).toHaveBeenCalledWith('Failed to connect to Redis, using mock mode:', 'Connection failed');

      const client = redisUtil.getClient();
      expect(client).not.toBeInstanceOf(Redis);
      expect(client.setex).toBeDefined();
    });

    it('should throw an error if getClient is called before connect in real mode', async () => {
      await redisUtil.disconnect();
      config.REDIS_URL = 'redis://localhost:6379';

      expect(() => redisUtil.getClient()).toThrow('Redis not initialized. Call connect() first.');
    });
  });

  describe('Mock Mode (REDIS_URL not set)', () => {
    beforeEach(async () => {
      config.REDIS_URL = '';
      await redisUtil.connect();
    });

    it('should set mock mode to true when REDIS_URL is falsy', () => {
      expect(logger.warn).toHaveBeenCalledWith('REDIS_URL not set, using mock Redis mode');
      const client = redisUtil.getClient();
      expect(client.setex).toBeDefined();
    });

    it('should set and get values in mock store', async () => {
      await redisUtil.set('test-key', { foo: 'bar' });
      const val = await redisUtil.get('test-key');
      expect(val).toEqual({ foo: 'bar' });
    });

    it('should return null for expired keys in mock store', async () => {
      await redisUtil.set('test-key', 'data', -1);
      const val = await redisUtil.get('test-key');
      expect(val).toBeNull();
    });

    it('should delete values from mock store', async () => {
      await redisUtil.set('test-key', 'data');
      await redisUtil.del('test-key');
      const val = await redisUtil.get('test-key');
      expect(val).toBeNull();
    });

    it('should handle sessions in mock store', async () => {
      await redisUtil.setSession('session-1', { userId: 123 });
      const session = await redisUtil.getSession('session-1');
      expect(session).toEqual({ userId: 123 });

      await redisUtil.deleteSession('session-1');
      const deletedSession = await redisUtil.getSession('session-1');
      expect(deletedSession).toBeNull();
    });

    it('should handle rate limits in mock store', async () => {
      let count = await redisUtil.incrementRateLimit('limit-key', 60);
      expect(count).toBe(1);
      count = await redisUtil.incrementRateLimit('limit-key', 60);
      expect(count).toBe(2);

      const limit = await redisUtil.getRateLimit('limit-key');
      expect(limit).toBe(2);
    });

    it('should return 0 for expired rate limits in mock store', async () => {
      await redisUtil.incrementRateLimit('limit-key', -1);
      const limit = await redisUtil.getRateLimit('limit-key');
      expect(limit).toBe(0);
    });
  });
});
