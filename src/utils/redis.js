const Redis = require('ioredis');
const logger = require('./logger');

const config = require('../config');

let redisClient = null;
let isMockMode = false;
let mockStore = new Map();

const redis = {
  connect: async () => {
    try {
      // Check if Redis URL is set
      if (!config.REDIS_URL || config.REDIS_URL === 'redis://localhost:6379') {
        logger.warn('Redis URL not configured, using mock Redis mode');
        isMockMode = true;
        mockStore = new Map();
        return;
      }

      redisClient = new Redis(config.REDIS_URL, {
        retryStrategy: (times) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
        maxRetriesPerRequest: 3,
      });

      redisClient.on('connect', () => {
        logger.info('Redis client connected');
      });

      redisClient.on('error', (error) => {
        logger.error('Redis client error:', error);
      });

      redisClient.on('reconnecting', () => {
        logger.warn('Redis client reconnecting...');
      });

      // Wait for connection
      await new Promise((resolve, reject) => {
        redisClient.once('ready', resolve);
        redisClient.once('error', reject);
      });

      logger.info('Connected to Redis successfully');
    } catch (error) {
      logger.error('Failed to connect to Redis, using mock mode:', error.message);
      isMockMode = true;
      mockStore = new Map();
    }
  },

  disconnect: async () => {
    if (redisClient && !isMockMode) {
      await redisClient.quit();
      logger.info('Disconnected from Redis');
    }
  },

  getClient: () => {
    if (isMockMode) {
      return createMockRedisClient();
    }
    if (!redisClient) {
      throw new Error('Redis not initialized. Call connect() first.');
    }
    return redisClient;
  },

  // Session store helpers
  setSession: async (sessionId, data, ttl = 86400) => {
    if (isMockMode) {
      mockStore.set(`session:${sessionId}`, { data, expires: Date.now() + ttl * 1000 });
      return;
    }
    const client = redis.getClient();
    await client.setex(`session:${sessionId}`, ttl, JSON.stringify(data));
  },

  getSession: async (sessionId) => {
    if (isMockMode) {
      const entry = mockStore.get(`session:${sessionId}`);
      if (entry && entry.expires > Date.now()) {
        return entry.data;
      }
      mockStore.delete(`session:${sessionId}`);
      return null;
    }
    const client = redis.getClient();
    const data = await client.get(`session:${sessionId}`);
    return data ? JSON.parse(data) : null;
  },

  deleteSession: async (sessionId) => {
    if (isMockMode) {
      mockStore.delete(`session:${sessionId}`);
      return;
    }
    const client = redis.getClient();
    await client.del(`session:${sessionId}`);
  },

  // Rate limiting helpers
  incrementRateLimit: async (key, windowSeconds) => {
    if (isMockMode) {
      const current = mockStore.get(`ratelimit:${key}`) || { count: 0, expires: Date.now() + windowSeconds * 1000 };
      current.count++;
      mockStore.set(`ratelimit:${key}`, current);
      return current.count;
    }
    const client = redis.getClient();
    const multi = client.multi();
    multi.incr(key);
    multi.expire(key, windowSeconds);
    const results = await multi.exec();
    return results[0][1];
  },

  getRateLimit: async (key) => {
    if (isMockMode) {
      const entry = mockStore.get(`ratelimit:${key}`);
      if (entry && entry.expires > Date.now()) {
        return entry.count;
      }
      return 0;
    }
    const client = redis.getClient();
    const count = await client.get(key);
    return parseInt(count) || 0;
  }
};

// Mock Redis client for development
function createMockRedisClient() {
  return {
    setex: async (key, ttl, value) => {
      mockStore.set(key, { data: value, expires: Date.now() + ttl * 1000 });
    },
    get: async (key) => {
      const entry = mockStore.get(key);
      if (entry && entry.expires > Date.now()) {
        return entry.data;
      }
      mockStore.delete(key);
      return null;
    },
    del: async (key) => {
      mockStore.delete(key);
    },
    multi: () => ({
      incr: (key) => {},
      expire: (key, ttl) => {},
      exec: async () => [[null, 1]]
    }),
    quit: async () => {}
  };
}

module.exports = redis;
