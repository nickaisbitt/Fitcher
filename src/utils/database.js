const { PrismaClient } = require('@prisma/client');
const logger = require('./logger');

let prisma = null;

const database = {
  connect: async () => {
    try {
      // Check if DATABASE_URL is set
      if (!process.env.DATABASE_URL) {
        logger.warn('DATABASE_URL not set, running in mock database mode');
        prisma = createMockPrisma();
        return;
      }

      prisma = new PrismaClient({
        log: [
          { emit: 'event', level: 'query' },
          { emit: 'event', level: 'info' },
          { emit: 'event', level: 'warn' },
          { emit: 'event', level: 'error' },
        ],
      });

      prisma.$on('query', (e) => {
        logger.debug('Prisma Query:', e.query);
      });

      prisma.$on('error', (e) => {
        logger.error('Prisma Error:', e.message);
      });

      await prisma.$connect();
      logger.info('Connected to database successfully');
    } catch (error) {
      logger.error('Failed to connect to database, using mock mode:', error.message);
      prisma = createMockPrisma();
    }
  },

  disconnect: async () => {
    if (prisma && !prisma.isMock) {
      await prisma.$disconnect();
      logger.info('Disconnected from database');
    }
  },

  getPrisma: () => {
    if (!prisma) {
      throw new Error('Database not initialized. Call connect() first.');
    }
    return prisma;
  }
};

// Mock Prisma client for development without database
function createMockPrisma() {
  logger.info('Using mock database (in-memory storage)');
  
  const mockUsers = new Map();
  const mockApiKeys = new Map();
  const mockOrders = new Map();
  const mockPositions = new Map();
  const mockBacktestResults = new Map();
  const mockDataSources = new Map();
  const mockIngestionJobs = new Map();
  const mockDataGaps = new Map();
  
  return {
    isMock: true,
    
    user: {
      findUnique: async ({ where }) => {
        return mockUsers.get(where.email) || mockUsers.get(where.id) || null;
      },
      findFirst: async ({ where }) => {
        for (const user of mockUsers.values()) {
          if (where.email && user.email === where.email) return user;
          if (where.id && user.id === where.id) return user;
        }
        return null;
      },
      create: async ({ data }) => {
        mockUsers.set(data.id, data);
        mockUsers.set(data.email, data);
        return data;
      },
      update: async ({ where, data }) => {
        const user = mockUsers.get(where.id);
        if (user) {
          Object.assign(user, data);
          return user;
        }
        return null;
      }
    },
    
    apiKey: {
      findMany: async ({ where }) => {
        const results = [];
        for (const key of mockApiKeys.values()) {
          if (!where || key.userId === where.userId) {
            results.push(key);
          }
        }
        return results;
      },
      create: async ({ data }) => {
        mockApiKeys.set(data.id, data);
        return data;
      }
    },
    
    order: {
      findMany: async ({ where }) => {
        const results = [];
        for (const order of mockOrders.values()) {
          if (!where || order.userId === where.userId) {
            results.push(order);
          }
        }
        return results;
      },
      create: async ({ data }) => {
        mockOrders.set(data.id, data);
        return data;
      },
      update: async ({ where, data }) => {
        const order = mockOrders.get(where.id);
        if (order) {
          Object.assign(order, data);
          return order;
        }
        return null;
      }
    },
    
    position: {
      findMany: async ({ where }) => {
        const results = [];
        for (const pos of mockPositions.values()) {
          if (!where || pos.userId === where.userId) {
            results.push(pos);
          }
        }
        return results;
      },
      create: async ({ data }) => {
        mockPositions.set(data.id, data);
        return data;
      },
      update: async ({ where, data }) => {
        const pos = mockPositions.get(where.id);
        if (pos) {
          Object.assign(pos, data);
          return pos;
        }
        return null;
      }
    },
    
    tradingStrategy: {
      findMany: async ({ where }) => [],
      create: async ({ data }) => data
    },
    
    tradingRule: {
      findMany: async ({ where }) => [],
      create: async ({ data }) => data
    },

    backtestResult: {
      findMany: async ({ where, orderBy, take, skip }) => {
        let results = Array.from(mockBacktestResults.values());

        if (where?.userId) {
          results = results.filter(r => r.userId === where.userId);
        }

        if (where?.type) {
          results = results.filter(r => r.type === where.type);
        }

        if (where?.strategyType) {
          results = results.filter(r => r.strategyType === where.strategyType);
        }

        if (where?.createdAt?.gte) {
          results = results.filter(r => new Date(r.createdAt) >= new Date(where.createdAt.gte));
        }

        if (where?.createdAt?.lte) {
          results = results.filter(r => new Date(r.createdAt) <= new Date(where.createdAt.lte));
        }

        if (orderBy?.createdAt === 'desc') {
          results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        }

        if (skip) {
          results = results.slice(skip);
        }

        if (take) {
          results = results.slice(0, take);
        }

        return results;
      },
      findFirst: async ({ where }) => {
        let results = Array.from(mockBacktestResults.values());

        if (where?.id) {
          results = results.filter(r => r.id === where.id);
        }

        if (where?.userId) {
          results = results.filter(r => r.userId === where.userId);
        }

        return results[0] || null;
      },
      create: async ({ data }) => {
        const record = {
          createdAt: data.createdAt || new Date(),
          ...data
        };
        mockBacktestResults.set(record.id, record);
        return record;
      }
    },

    dataSource: {
      findMany: async ({ where }) => {
        let results = Array.from(mockDataSources.values());
        if (where?.pair) results = results.filter(r => r.pair === where.pair);
        if (where?.timeframe) results = results.filter(r => r.timeframe === where.timeframe);
        if (where?.exchange) results = results.filter(r => r.exchange === where.exchange);
        if (where?.isComplete !== undefined) results = results.filter(r => r.isComplete === where.isComplete);
        return results;
      },
      findUnique: async ({ where }) => {
        const key = `${where.pair}-${where.timeframe}-${where.exchange}`;
        return mockDataSources.get(key) || null;
      },
      upsert: async ({ where, create, update }) => {
        const key = `${where.pair}-${where.timeframe}-${where.exchange}`;
        const existing = mockDataSources.get(key);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        mockDataSources.set(key, create);
        return create;
      }
    },

    ingestionJob: {
      findMany: async ({ where, orderBy, take }) => {
        let results = Array.from(mockIngestionJobs.values());
        if (where?.status) results = results.filter(r => r.status === where.status);
        if (where?.pair) results = results.filter(r => r.pair === where.pair);
        if (orderBy?.createdAt === 'desc') results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        if (orderBy?.priority === 'desc') results.sort((a, b) => b.priority - a.priority);
        if (take) results = results.slice(0, take);
        return results;
      },
      findFirst: async ({ where }) => {
        let results = Array.from(mockIngestionJobs.values());
        if (where?.id) results = results.filter(r => r.id === where.id);
        return results[0] || null;
      },
      create: async ({ data }) => {
        mockIngestionJobs.set(data.id, data);
        return data;
      },
      update: async ({ where, data }) => {
        const job = mockIngestionJobs.get(where.id);
        if (job) {
          Object.assign(job, data);
          return job;
        }
        return null;
      }
    },

    dataGap: {
      findMany: async ({ where }) => {
        let results = Array.from(mockDataGaps.values());
        if (where?.pair) results = results.filter(r => r.pair === where.pair);
        if (where?.timeframe) results = results.filter(r => r.timeframe === where.timeframe);
        if (where?.isRepaired !== undefined) results = results.filter(r => r.isRepaired === where.isRepaired);
        return results;
      },
      create: async ({ data }) => {
        mockDataGaps.set(data.id, data);
        return data;
      },
      update: async ({ where, data }) => {
        const gap = mockDataGaps.get(where.id);
        if (gap) {
          Object.assign(gap, data);
          return gap;
        }
        return null;
      }
    }
  };
}

module.exports = database;
