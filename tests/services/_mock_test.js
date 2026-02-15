vi.mock('../../src/utils/redis', () => {
  const mock = {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    connect: vi.fn(),
    disconnect: vi.fn(),
    getClient: vi.fn()
  };
  return { default: mock, ...mock };
});

const redis = require('../../src/utils/redis');

describe('mock test', () => {
  it('should use mock', async () => {
    expect(typeof redis.get).toBe('function');
    const result = await redis.get('test');
    expect(result).toBeNull();
  });
});
