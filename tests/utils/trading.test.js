// vitest globals (describe, it, expect) are injected via vitest.config.js globals: true
const { parseTimeframe, normalizeSymbol, sleep, validateCandle, normalizeOHLCV } = require('../../src/utils/trading');

// ---------- parseTimeframe ----------
describe('parseTimeframe', () => {
  it('parses 1m to 60000ms', () => {
    expect(parseTimeframe('1m')).toBe(60_000);
  });

  it('parses 5m to 300000ms', () => {
    expect(parseTimeframe('5m')).toBe(5 * 60_000);
  });

  it('parses 15m to 900000ms', () => {
    expect(parseTimeframe('15m')).toBe(15 * 60_000);
  });

  it('parses 30m to 1800000ms', () => {
    expect(parseTimeframe('30m')).toBe(30 * 60_000);
  });

  it('parses 1h to 3600000ms', () => {
    expect(parseTimeframe('1h')).toBe(3_600_000);
  });

  it('parses 4h to 14400000ms', () => {
    expect(parseTimeframe('4h')).toBe(4 * 3_600_000);
  });

  it('parses 1d to 86400000ms', () => {
    expect(parseTimeframe('1d')).toBe(86_400_000);
  });

  it('parses 1w to 604800000ms', () => {
    expect(parseTimeframe('1w')).toBe(7 * 86_400_000);
  });

  it('throws for null', () => {
    expect(() => parseTimeframe(null)).toThrow('Invalid timeframe');
  });

  it('throws for empty string', () => {
    expect(() => parseTimeframe('')).toThrow('Invalid timeframe');
  });

  it('throws for "abc"', () => {
    expect(() => parseTimeframe('abc')).toThrow('Invalid timeframe format');
  });

  it('throws for "1x" (unknown unit)', () => {
    expect(() => parseTimeframe('1x')).toThrow('Invalid timeframe format');
  });

  it('throws for "h1" (unit before number)', () => {
    expect(() => parseTimeframe('h1')).toThrow('Invalid timeframe format');
  });

  it('handles large numbers like 100d', () => {
    expect(parseTimeframe('100d')).toBe(100 * 86_400_000);
  });
});

// ---------- normalizeSymbol ----------
describe('normalizeSymbol', () => {
  it('returns BTC/USD unchanged', () => {
    expect(normalizeSymbol('BTC/USD')).toBe('BTC/USD');
  });

  it('converts dash format BTC-USD to BTC/USD', () => {
    expect(normalizeSymbol('BTC-USD')).toBe('BTC/USD');
  });

  it('converts lowercase concatenated btcusd to BTC/USD', () => {
    expect(normalizeSymbol('btcusd')).toBe('BTC/USD');
  });

  it('converts BTCUSDT to BTC/USDT', () => {
    expect(normalizeSymbol('BTCUSDT')).toBe('BTC/USDT');
  });

  it('splits XBTUSD as XBT/USD', () => {
    expect(normalizeSymbol('XBTUSD')).toBe('XBT/USD');
  });

  it('throws for empty string', () => {
    expect(() => normalizeSymbol('')).toThrow('Invalid symbol');
  });

  it('throws for null', () => {
    expect(() => normalizeSymbol(null)).toThrow('Invalid symbol');
  });

  it('handles ETH-BTC dash format', () => {
    expect(normalizeSymbol('ETH-BTC')).toBe('ETH/BTC');
  });

  it('handles lowercase ethbtc', () => {
    expect(normalizeSymbol('ethbtc')).toBe('ETH/BTC');
  });

  it('preserves already-uppercased slash format', () => {
    expect(normalizeSymbol('SOL/USDC')).toBe('SOL/USDC');
  });
});

// ---------- sleep ----------
describe('sleep', () => {
  it('resolves after the specified delay', async () => {
    const start = Date.now();
    await sleep(50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40); // allow small timer jitter
  });

  it('does not resolve too early', async () => {
    let resolved = false;
    const p = sleep(100).then(() => { resolved = true; });
    await sleep(20);
    expect(resolved).toBe(false);
    await p;
    expect(resolved).toBe(true);
  });
});

// ---------- validateCandle ----------
describe('validateCandle', () => {
  const validCandle = {
    timestamp: 1700000000000,
    open: 100,
    high: 110,
    low: 90,
    close: 105,
    volume: 500,
  };

  it('returns valid for a correct candle', () => {
    const result = validateCandle(validCandle);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects null input', () => {
    const result = validateCandle(null);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/must be an object/);
  });

  it('reports missing fields', () => {
    const result = validateCandle({ timestamp: 1 });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
    expect(result.errors.some(e => e.includes('open'))).toBe(true);
  });

  it('rejects when high < low', () => {
    const result = validateCandle({ ...validCandle, high: 80, low: 90 });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('high'))).toBe(true);
  });

  it('rejects negative volume', () => {
    const result = validateCandle({ ...validCandle, volume: -1 });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('volume'))).toBe(true);
  });

  it('rejects NaN values', () => {
    const result = validateCandle({ ...validCandle, open: NaN });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('open'))).toBe(true);
  });

  it('rejects when high < open', () => {
    const result = validateCandle({ ...validCandle, open: 115, high: 110 });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('high'))).toBe(true);
  });

  it('rejects when low > close', () => {
    const result = validateCandle({ ...validCandle, close: 85, low: 90 });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('low'))).toBe(true);
  });

  it('accepts zero volume', () => {
    const result = validateCandle({ ...validCandle, volume: 0 });
    expect(result.valid).toBe(true);
  });
});

// ---------- normalizeOHLCV ----------
describe('normalizeOHLCV', () => {
  it('normalizes array format [ts, o, h, l, c, v]', () => {
    const raw = [[1000, 10, 12, 9, 11, 50]];
    const result = normalizeOHLCV(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      timestamp: 1000,
      open: 10,
      high: 12,
      low: 9,
      close: 11,
      volume: 50,
    });
  });

  it('normalizes object format', () => {
    const raw = [{ timestamp: 2000, open: 20, high: 22, low: 18, close: 21, volume: 100 }];
    const result = normalizeOHLCV(raw);
    expect(result[0]).toEqual({
      timestamp: 2000,
      open: 20,
      high: 22,
      low: 18,
      close: 21,
      volume: 100,
    });
  });

  it('handles mixed array and object entries', () => {
    const raw = [
      [1000, 10, 12, 9, 11, 50],
      { timestamp: 2000, open: 20, high: 22, low: 18, close: 21, volume: 100 },
    ];
    const result = normalizeOHLCV(raw);
    expect(result).toHaveLength(2);
    expect(result[0].timestamp).toBe(1000);
    expect(result[1].timestamp).toBe(2000);
  });

  it('returns empty array for empty input', () => {
    expect(normalizeOHLCV([])).toEqual([]);
  });

  it('returns empty array for non-array input', () => {
    expect(normalizeOHLCV(null)).toEqual([]);
    expect(normalizeOHLCV('string')).toEqual([]);
    expect(normalizeOHLCV(42)).toEqual([]);
    expect(normalizeOHLCV(undefined)).toEqual([]);
  });

  it('preserves zero values via nullish coalescing', () => {
    const raw = [{ timestamp: 0, open: 0, high: 0, low: 0, close: 0, volume: 0 }];
    const result = normalizeOHLCV(raw);
    expect(result[0].open).toBe(0);
    expect(result[0].volume).toBe(0);
    expect(result[0].timestamp).toBe(0);
  });
});
