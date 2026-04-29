import { describe, it, expect, vi, beforeEach } from 'vitest';
import ExchangeAdapterFactory from '../../src/adapters/ExchangeAdapterFactory';

describe('ExchangeAdapterFactory - disconnectAll', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clear the map to have a clean state
    ExchangeAdapterFactory.adapters.clear();
  });

  it('should disconnect all adapters and clear the map', async () => {
    const mockAdapter1 = { disconnect: vi.fn().mockResolvedValue() };
    const mockAdapter2 = { disconnect: vi.fn().mockResolvedValue() };

    ExchangeAdapterFactory.adapters.set('adapter1', mockAdapter1);
    ExchangeAdapterFactory.adapters.set('adapter2', mockAdapter2);

    await ExchangeAdapterFactory.disconnectAll();

    expect(mockAdapter1.disconnect).toHaveBeenCalledTimes(1);
    expect(mockAdapter2.disconnect).toHaveBeenCalledTimes(1);
    expect(ExchangeAdapterFactory.adapters.size).toBe(0);
  });

  it('should continue disconnecting remaining adapters if one fails', async () => {
    const error = new Error('Disconnect failed');
    const mockAdapter1 = { disconnect: vi.fn().mockRejectedValue(error) };
    const mockAdapter2 = { disconnect: vi.fn().mockResolvedValue() };

    ExchangeAdapterFactory.adapters.set('adapter1', mockAdapter1);
    ExchangeAdapterFactory.adapters.set('adapter2', mockAdapter2);

    await ExchangeAdapterFactory.disconnectAll();

    expect(mockAdapter1.disconnect).toHaveBeenCalledTimes(1);
    expect(mockAdapter2.disconnect).toHaveBeenCalledTimes(1);
    expect(ExchangeAdapterFactory.adapters.size).toBe(0);
  });
});
