const crypto = require("crypto");
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

// ---------------------------------------------------------------------------
// Mock Prisma client for development without a real database
// ---------------------------------------------------------------------------
// Supports the Prisma-like query patterns actually used in the codebase,
// including compound-unique where clauses and the `{ in: [...] }` filter.
// ---------------------------------------------------------------------------
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
  const mockStrategies = new Map();
  const mockRules = new Map();

  // ---- helpers ------------------------------------------------------------

  /** Match a single Prisma-style where-value against a record value.
   *  Supports: plain equality, { in: [...] }, { gte }, { lte }, { contains }.
   */
  function matchField(recordVal, filterVal) {
    if (filterVal === null || filterVal === undefined) return true;
    if (typeof filterVal === 'object' && !Array.isArray(filterVal) && !(filterVal instanceof Date)) {
      // Prisma filter object
      if (filterVal.in) return filterVal.in.includes(recordVal);
      if (filterVal.gte !== undefined && recordVal < filterVal.gte) return false;
      if (filterVal.lte !== undefined && recordVal > filterVal.lte) return false;
      if (filterVal.contains !== undefined) return String(recordVal).includes(filterVal.contains);
      return true;
    }
    return recordVal === filterVal;
  }

  /** Filter an array of records by a Prisma-style where clause. */
  function applyWhere(records, where) {
    if (!where) return records;
    return records.filter(r => {
      for (const [key, val] of Object.entries(where)) {
        if (!matchField(r[key], val)) return false;
      }
      return true;
    });
  }

  /** Sort an array by a Prisma-style orderBy clause. */
  function applyOrderBy(records, orderBy) {
    if (!orderBy) return records;
    const entries = typeof orderBy === 'object' ? Object.entries(orderBy) : [];
    if (entries.length === 0) return records;
    const [field, dir] = entries[0];
    return records.sort((a, b) => {
      const va = a[field], vb = b[field];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const cmp = va > vb ? 1 : va < vb ? -1 : 0;
      return dir === 'desc' ? -cmp : cmp;
    });
  }

  /** Build a generic model mock for a given Map store. */
  function makeModel(store) {
    return {
      findMany: async ({ where, orderBy, take, skip } = {}) => {
        let results = applyWhere(Array.from(store.values()), where);
        results = applyOrderBy(results, orderBy);
        if (skip) results = results.slice(skip);
        if (take) results = results.slice(0, take);
        return results;
      },
      findFirst: async ({ where, orderBy } = {}) => {
        let results = applyWhere(Array.from(store.values()), where);
        results = applyOrderBy(results, orderBy);
        return results[0] || null;
      },
      findUnique: async ({ where }) => {
        if (where.id) return store.get(where.id) || null;
        // fallback: linear scan
        for (const record of store.values()) {
          let match = true;
          for (const [k, v] of Object.entries(where)) {
            if (record[k] !== v) { match = false; break; }
          }
          if (match) return record;
        }
        return null;
      },
      create: async ({ data }) => {
        const record = { createdAt: new Date(), ...data };
        if (!record.id) record.id = `mock_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
        store.set(record.id, record);
        return record;
      },
      update: async ({ where, data }) => {
        const record = store.get(where.id);
        if (record) {
          Object.assign(record, data);
          return record;
        }
        return null;
      },
      delete: async ({ where }) => {
        const record = store.get(where.id);
        if (record) {
          store.delete(where.id);
          return record;
        }
        return null;
      },
      count: async ({ where } = {}) => {
        return applyWhere(Array.from(store.values()), where).length;
      },
      upsert: async ({ where, create, update }) => {
        // Try to find existing
        const existing = await makeModel(store).findUnique({ where });
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const record = { createdAt: new Date(), ...create };
        if (!record.id) record.id = `mock_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
        store.set(record.id, record);
        return record;
      }
    };
  }

  // ---- user model (special: indexed by both id and email) -----------------
  const userModel = {
    ...makeModel(mockUsers),
    findUnique: async ({ where }) => {
      return mockUsers.get(where.email) || mockUsers.get(where.id) || null;
    },
    create: async ({ data }) => {
      const record = { createdAt: new Date(), ...data };
      if (!record.id) record.id = `mock_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      mockUsers.set(record.id, record);
      if (record.email) mockUsers.set(record.email, record);
      return record;
    }
  };

  // ---- dataSource model (special: compound unique key) --------------------
  const dataSourceModel = {
    ...makeModel(mockDataSources),
    findUnique: async ({ where }) => {
      // Prisma compound unique: where.pair_timeframe_exchange = { pair, timeframe, exchange }
      const compound = where.pair_timeframe_exchange || where;
      const key = `${compound.pair}-${compound.timeframe}-${compound.exchange}`;
      return mockDataSources.get(key) || null;
    },
    upsert: async ({ where, create, update }) => {
      const compound = where.pair_timeframe_exchange || where;
      const key = `${compound.pair}-${compound.timeframe}-${compound.exchange}`;
      const existing = mockDataSources.get(key);
      if (existing) {
        Object.assign(existing, update);
        return existing;
      }
      const record = { createdAt: new Date(), ...create };
      mockDataSources.set(key, record);
      return record;
    }
  };

  return {
    isMock: true,

    // Prisma-level methods
    $transaction: async (fn) => {
      // Simple mock: just execute sequentially (no real transactional rollback)
      if (typeof fn === 'function') {
        return fn({
          user: userModel,
          apiKey: makeModel(mockApiKeys),
          order: makeModel(mockOrders),
          position: makeModel(mockPositions),
          backtestResult: makeModel(mockBacktestResults),
          tradingStrategy: makeModel(mockStrategies),
          tradingRule: makeModel(mockRules),
          dataSource: dataSourceModel,
          ingestionJob: makeModel(mockIngestionJobs),
          dataGap: makeModel(mockDataGaps)
        });
      }
      // Array-of-promises form
      return Promise.all(fn);
    },

    user: userModel,
    apiKey: makeModel(mockApiKeys),
    order: makeModel(mockOrders),
    position: makeModel(mockPositions),
    backtestResult: makeModel(mockBacktestResults),
    tradingStrategy: makeModel(mockStrategies),
    tradingRule: makeModel(mockRules),
    dataSource: dataSourceModel,
    ingestionJob: makeModel(mockIngestionJobs),
    dataGap: makeModel(mockDataGaps)
  };
}

module.exports = database;
