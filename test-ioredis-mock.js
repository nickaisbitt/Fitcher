const { vi } = require('vitest');
vi.mock('ioredis', () => {
  return {
    default: class Redis {
      constructor() { this.isMocked = true; }
    }
  };
});
const Redis = require('ioredis');
console.log(new Redis());
