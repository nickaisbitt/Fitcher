// vitest globals (describe, it, expect, vi) are injected via vitest.config.js globals: true

const { errorHandler, asyncHandler, requestId } = require('../../src/middleware/errorHandler');
const logger = require('../../src/utils/logger');

function mockReqResNext(reqOverrides = {}) {
  const req = { url: '/test', method: 'GET', ip: '127.0.0.1', headers: {}, ...reqOverrides };
  const res = {
    _status: null,
    _json: null,
    _headers: {},
    status(code) { this._status = code; return this; },
    json(body) { this._json = body; return this; },
    setHeader(k, v) { this._headers[k] = v; },
  };
  const next = vi.fn();
  return { req, res, next };
}

// ---------- errorHandler ----------
describe('errorHandler', () => {
  let origLogError;

  beforeEach(() => {
    // Spy on the real logger.error
    origLogError = logger.error;
    logger.error = vi.fn();
  });

  afterEach(() => {
    logger.error = origLogError;
  });

  it('returns 500 for generic error', () => {
    const { req, res, next } = mockReqResNext();
    errorHandler(new Error('boom'), req, res, next);
    expect(res._status).toBe(500);
  });

  it('uses err.status when provided', () => {
    const err = new Error('not found');
    err.status = 404;
    const { req, res, next } = mockReqResNext();
    errorHandler(err, req, res, next);
    expect(res._status).toBe(404);
  });

  it('hides error message in production', () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const { req, res, next } = mockReqResNext();
      errorHandler(new Error('secret leak'), req, res, next);
      expect(res._json.error).toBe('Internal server error');
      expect(res._json.stack).toBeUndefined();
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  });

  it('shows error message and stack in development', () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const { req, res, next } = mockReqResNext();
      const err = new Error('dev error');
      errorHandler(err, req, res, next);
      expect(res._json.error).toBe('dev error');
      expect(res._json.stack).toBeDefined();
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  });

  it('includes requestId from req.id', () => {
    const { req, res, next } = mockReqResNext({ id: 'req-123' });
    errorHandler(new Error('fail'), req, res, next);
    expect(res._json.requestId).toBe('req-123');
  });

  it('logs error details', () => {
    const { req, res, next } = mockReqResNext({ id: 'req-456' });
    errorHandler(new Error('log me'), req, res, next);
    expect(logger.error).toHaveBeenCalled();
    const call = logger.error.mock.calls[0];
    expect(call[0]).toContain('req-456');
  });
});

// ---------- asyncHandler ----------
describe('asyncHandler', () => {
  it('passes through successful async function', async () => {
    const handler = asyncHandler(async (req, res) => {
      res.json({ ok: true });
    });
    const { req, res, next } = mockReqResNext();
    await handler(req, res, next);
    expect(res._json).toEqual({ ok: true });
    expect(next).not.toHaveBeenCalled();
  });

  it('catches rejected promise and calls next', async () => {
    const err = new Error('async fail');
    const handler = asyncHandler(async () => { throw err; });
    const { req, res, next } = mockReqResNext();
    await handler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });

  it('catches thrown error and calls next', async () => {
    const err = new Error('sync throw in async');
    const handler = asyncHandler(async () => { throw err; });
    const { req, res, next } = mockReqResNext();
    await handler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

// ---------- requestId ----------
describe('requestId middleware', () => {
  it('generates UUID when no x-request-id header present', () => {
    const { req, res, next } = mockReqResNext();
    requestId(req, res, next);
    expect(req.id).toBeDefined();
    expect(typeof req.id).toBe('string');
    // UUID v4 pattern
    expect(req.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(res._headers['X-Request-Id']).toBe(req.id);
    expect(next).toHaveBeenCalled();
  });
});
