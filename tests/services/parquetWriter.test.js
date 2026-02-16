/**
 * Tests for src/services/parquetWriter.js
 */

const fs = require('fs');
const parquet = require('parquetjs-lite');
const logger = require('../../src/utils/logger');

// Mock logger
vi.spyOn(logger, 'info').mockImplementation(() => {});
vi.spyOn(logger, 'warn').mockImplementation(() => {});
vi.spyOn(logger, 'error').mockImplementation(() => {});
vi.spyOn(logger, 'debug').mockImplementation(() => {});

// Mock fs.promises
vi.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined);
vi.spyOn(fs.promises, 'access').mockResolvedValue(undefined);
vi.spyOn(fs.promises, 'stat').mockResolvedValue({ size: 1024 });
vi.spyOn(fs.promises, 'readdir').mockResolvedValue([]);
vi.spyOn(fs.promises, 'unlink').mockResolvedValue(undefined);
vi.spyOn(fs.promises, 'rename').mockResolvedValue(undefined);

// Mock parquetjs-lite
const mockAppendRow = vi.fn().mockResolvedValue(undefined);
const mockWriterClose = vi.fn().mockResolvedValue(undefined);
vi.spyOn(parquet.ParquetWriter, 'openFile').mockResolvedValue({
  appendRow: mockAppendRow,
  close: mockWriterClose
});

const mockReaderClose = vi.fn().mockResolvedValue(undefined);
const mockCursorNext = vi.fn().mockResolvedValue(null);
vi.spyOn(parquet.ParquetReader, 'openFile').mockResolvedValue({
  getCursor: () => ({ next: mockCursorNext }),
  close: mockReaderClose
});

const ParquetWriter = require('../../src/services/parquetWriter');
const { createMockCandle } = require('../helpers/fixtures');

describe('ParquetWriter', () => {
  let writer;

  beforeEach(() => {
    writer = new ParquetWriter('/tmp/test-parquet');
    vi.clearAllMocks();

    // Restore default mock behaviors after clearAllMocks
    fs.promises.mkdir.mockResolvedValue(undefined);
    fs.promises.access.mockResolvedValue(undefined);
    fs.promises.stat.mockResolvedValue({ size: 1024 });
    fs.promises.readdir.mockResolvedValue([]);
    fs.promises.unlink.mockResolvedValue(undefined);
    fs.promises.rename.mockResolvedValue(undefined);

    parquet.ParquetWriter.openFile.mockResolvedValue({
      appendRow: mockAppendRow,
      close: mockWriterClose
    });
    mockAppendRow.mockResolvedValue(undefined);
    mockWriterClose.mockResolvedValue(undefined);

    parquet.ParquetReader.openFile.mockResolvedValue({
      getCursor: () => ({ next: mockCursorNext }),
      close: mockReaderClose
    });
    mockCursorNext.mockResolvedValue(null);
    mockReaderClose.mockResolvedValue(undefined);

    logger.info.mockImplementation(() => {});
    logger.warn.mockImplementation(() => {});
    logger.error.mockImplementation(() => {});
    logger.debug.mockImplementation(() => {});
  });

  // ---------------------------------------------------------------
  // constructor
  // ---------------------------------------------------------------

  describe('constructor', () => {
    it('sets basePath', () => {
      const w = new ParquetWriter('/custom/path');
      expect(w.basePath).toBe('/custom/path');
    });

    it('uses default basePath', () => {
      const w = new ParquetWriter();
      expect(w.basePath).toBe('./data/parquet');
    });
  });

  // ---------------------------------------------------------------
  // toTimestampString
  // ---------------------------------------------------------------

  describe('toTimestampString', () => {
    it('converts number to ISO string', () => {
      const ts = 1700000000000;
      const result = writer.toTimestampString(ts);
      expect(result).toBe(new Date(ts).toISOString());
    });

    it('converts Date to ISO string', () => {
      const date = new Date('2024-06-15T12:00:00Z');
      const result = writer.toTimestampString(date);
      expect(result).toBe('2024-06-15T12:00:00.000Z');
    });
  });

  // ---------------------------------------------------------------
  // parseTimestamp
  // ---------------------------------------------------------------

  describe('parseTimestamp', () => {
    it('converts ISO string to number', () => {
      const iso = '2024-06-15T12:00:00.000Z';
      const result = writer.parseTimestamp(iso);
      expect(result).toBe(new Date(iso).getTime());
    });

    it('returns null for null input', () => {
      expect(writer.parseTimestamp(null)).toBeNull();
    });
  });

  // ---------------------------------------------------------------
  // getYearMonth
  // ---------------------------------------------------------------

  describe('getYearMonth', () => {
    it('returns correct YYYY-MM format', () => {
      // Use a UTC timestamp to avoid timezone issues
      const ts = Date.UTC(2024, 2, 15, 10, 0, 0); // March 15, 2024
      expect(writer.getYearMonth(ts)).toBe('2024-03');
    });
  });

  // ---------------------------------------------------------------
  // getYearMonthsInRange
  // ---------------------------------------------------------------

  describe('getYearMonthsInRange', () => {
    it('returns all months in range', () => {
      // Use explicit UTC-based Date objects
      const start = new Date(Date.UTC(2024, 0, 15)); // Jan 15, 2024
      const end = new Date(Date.UTC(2024, 2, 15));   // Mar 15, 2024
      const months = writer.getYearMonthsInRange(start, end);

      expect(months).toContain('2024-01');
      expect(months).toContain('2024-02');
      expect(months).toContain('2024-03');
      expect(months.length).toBe(3);
    });

    it('handles crossing year boundary', () => {
      const start = new Date(Date.UTC(2023, 10, 15)); // Nov 15, 2023
      const end = new Date(Date.UTC(2024, 1, 15));    // Feb 15, 2024
      const months = writer.getYearMonthsInRange(start, end);

      expect(months).toContain('2023-11');
      expect(months).toContain('2023-12');
      expect(months).toContain('2024-01');
      expect(months).toContain('2024-02');
      expect(months.length).toBe(4);
    });
  });

  // ---------------------------------------------------------------
  // formatBytes
  // ---------------------------------------------------------------

  describe('formatBytes', () => {
    it('formats 0 bytes', () => {
      expect(writer.formatBytes(0)).toBe('0 Bytes');
    });

    it('formats KB', () => {
      const result = writer.formatBytes(2048);
      expect(result).toBe('2 KB');
    });

    it('formats MB', () => {
      const result = writer.formatBytes(1048576);
      expect(result).toBe('1 MB');
    });
  });

  // ---------------------------------------------------------------
  // writeCandles
  // ---------------------------------------------------------------

  describe('writeCandles', () => {
    it('throws on empty candles', async () => {
      await expect(writer.writeCandles('BTC/USD', '1h', [])).rejects.toThrow('No candles to write');
    });

    it('creates directory and writes file', async () => {
      const candles = [
        createMockCandle({ timestamp: Date.UTC(2024, 5, 15, 12, 0, 0) }),
        createMockCandle({ timestamp: Date.UTC(2024, 5, 15, 13, 0, 0) })
      ];

      const result = await writer.writeCandles('BTC/USD', '1h', candles);

      expect(fs.promises.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('BTC-USD'),
        { recursive: true }
      );
      expect(parquet.ParquetWriter.openFile).toHaveBeenCalled();
      expect(mockAppendRow).toHaveBeenCalledTimes(2);
      expect(mockWriterClose).toHaveBeenCalled();
      expect(result.candlesWritten).toBe(2);
      expect(result.fileSize).toBe(1024);
    });
  });

  // ---------------------------------------------------------------
  // appendCandles - deduplication bug fix
  // ---------------------------------------------------------------

  describe('appendCandles', () => {
    it('deduplication keeps NEW data (our bug fix)', async () => {
      const ts = Date.UTC(2024, 5, 15, 12, 0, 0);

      // The "new" candles we're appending have close=999
      const newCandles = [
        createMockCandle({ timestamp: ts, close: 999 })
      ];

      // The "existing" candles have close=100 (stale data)
      const existingCandle = {
        timestamp: writer.toTimestampString(ts),
        open: 100, high: 105, low: 95, close: 100, volume: 1000
      };

      // Mock access to indicate file exists
      fs.promises.access.mockResolvedValueOnce(undefined);

      // Mock reader for existing candles
      let readerCallCount = 0;
      parquet.ParquetReader.openFile.mockResolvedValueOnce({
        getCursor: () => ({
          next: async () => {
            if (readerCallCount === 0) {
              readerCallCount++;
              return existingCandle;
            }
            return null;
          }
        }),
        close: vi.fn().mockResolvedValue(undefined)
      });

      // Track what's written
      const writtenRows = [];
      mockAppendRow.mockImplementation(async (row) => { writtenRows.push(row); });

      await writer.appendCandles('BTC/USD', '1h', newCandles);

      // The merged array is [...newCandles, ...existingCandles], sorted by timestamp.
      // Dedup keeps first occurrence — the new candle (close=999) wins.
      const rowForTs = writtenRows.find(row =>
        row.timestamp === writer.toTimestampString(ts)
      );
      expect(rowForTs).toBeDefined();
      expect(rowForTs.close).toBe(999);
    });

    it('sorts by timestamp', async () => {
      const ts1 = Date.UTC(2024, 5, 15, 14, 0, 0);
      const ts2 = Date.UTC(2024, 5, 15, 12, 0, 0);
      const ts3 = Date.UTC(2024, 5, 15, 13, 0, 0);

      const candles = [
        createMockCandle({ timestamp: ts1 }),
        createMockCandle({ timestamp: ts2 }),
        createMockCandle({ timestamp: ts3 })
      ];

      // File doesn't exist
      fs.promises.access.mockRejectedValueOnce(new Error('ENOENT'));

      const writtenRows = [];
      mockAppendRow.mockImplementation(async (row) => { writtenRows.push(row); });

      await writer.appendCandles('BTC/USD', '1h', candles);

      // Verify rows were written in timestamp order
      const timestamps = writtenRows.map(r => new Date(r.timestamp).getTime());
      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
      }
    });
  });

  // ---------------------------------------------------------------
  // readRange
  // ---------------------------------------------------------------

  describe('readRange', () => {
    it('filters candles to date range', async () => {
      const start = new Date(Date.UTC(2024, 5, 1));    // June 1
      const end = new Date(Date.UTC(2024, 5, 30, 23, 59, 59)); // June 30

      const juneTs = Date.UTC(2024, 5, 15, 12, 0, 0);
      const julyTs = Date.UTC(2024, 6, 2, 12, 0, 0);

      // Mock file existence
      fs.promises.access.mockResolvedValue(undefined);

      // Return two candles: one in June, one in July
      let readCallIdx = 0;
      const records = [
        { timestamp: new Date(juneTs).toISOString(), open: 100, high: 105, low: 95, close: 102, volume: 1000 },
        { timestamp: new Date(julyTs).toISOString(), open: 100, high: 105, low: 95, close: 102, volume: 1000 }
      ];
      parquet.ParquetReader.openFile.mockResolvedValue({
        getCursor: () => ({
          next: async () => {
            if (readCallIdx < records.length) {
              return records[readCallIdx++];
            }
            return null;
          }
        }),
        close: vi.fn().mockResolvedValue(undefined)
      });

      const candles = await writer.readRange('BTC/USD', '1h', start, end);

      // All returned candles should be within range
      for (const c of candles) {
        expect(c.timestamp).toBeGreaterThanOrEqual(start.getTime());
        expect(c.timestamp).toBeLessThanOrEqual(end.getTime());
      }
    });

    it('returns empty for missing directory', async () => {
      // access always rejects (files don't exist)
      fs.promises.access.mockRejectedValue(new Error('ENOENT'));

      // Reader should never be called because access fails
      parquet.ParquetReader.openFile.mockRejectedValue(new Error('ENOENT'));

      const start = new Date(Date.UTC(2024, 5, 1));
      const end = new Date(Date.UTC(2024, 5, 30));

      const candles = await writer.readRange('BTC/USD', '1h', start, end);
      expect(candles).toEqual([]);
    });
  });

  // ---------------------------------------------------------------
  // getAvailableRange
  // ---------------------------------------------------------------

  describe('getAvailableRange', () => {
    it('returns null for missing directory', async () => {
      fs.promises.readdir.mockRejectedValueOnce(new Error('ENOENT'));
      const result = await writer.getAvailableRange('BTC/USD', '1h');
      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------
  // deleteBefore
  // ---------------------------------------------------------------

  describe('deleteBefore', () => {
    it('removes old files', async () => {
      fs.promises.readdir.mockResolvedValueOnce(['2024-01.parquet', '2024-03.parquet', '2024-06.parquet']);

      // Use mid-month date to avoid timezone edge case where getMonth() shifts
      const beforeDate = new Date(Date.UTC(2024, 3, 15, 12, 0, 0)); // April 15
      const deleted = await writer.deleteBefore('BTC/USD', '1h', beforeDate);

      // Files before 2024-04: 2024-01 and 2024-03
      expect(deleted).toBe(2);
      expect(fs.promises.unlink).toHaveBeenCalledTimes(2);
    });

    it('returns 0 on error', async () => {
      fs.promises.readdir.mockRejectedValueOnce(new Error('ENOENT'));

      const deleted = await writer.deleteBefore('BTC/USD', '1h', new Date(Date.UTC(2024, 3, 15, 12, 0, 0)));
      expect(deleted).toBe(0);
    });
  });

  // ---------------------------------------------------------------
  // initialize
  // ---------------------------------------------------------------

  describe('initialize', () => {
    it('creates basePath directory', async () => {
      await writer.initialize();
      expect(fs.promises.mkdir).toHaveBeenCalledWith('/tmp/test-parquet', { recursive: true });
    });
  });
});
