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
    }
  };
}

module.exports = database;
