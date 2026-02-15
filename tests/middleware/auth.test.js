// vitest globals (describe, it, expect, vi) are injected via vitest.config.js globals: true

// Set env vars BEFORE any require so config picks them up
process.env.JWT_SECRET = 'test-secret-key-for-testing';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-key';
process.env.JWT_EXPIRES_IN = '1h';
process.env.REFRESH_TOKEN_EXPIRES_IN = '7d';
process.env.DATABASE_URL = 'postgres://fake';

const jwt = require('jsonwebtoken');
const { validateJWT, generateTokens } = require('../../src/middleware/auth');

const TEST_SECRET = 'test-secret-key-for-testing';
const TEST_REFRESH_SECRET = 'test-refresh-secret-key';

function mockReqResNext(headers = {}) {
  const req = { headers };
  const res = {
    _status: null,
    _json: null,
    status(code) { this._status = code; return this; },
    json(body) { this._json = body; return this; },
  };
  const next = vi.fn();
  return { req, res, next };
}

// ---------- generateTokens ----------
describe('generateTokens', () => {
  it('returns accessToken and refreshToken', () => {
    const tokens = generateTokens('user-1', 'test@example.com');
    expect(tokens).toHaveProperty('accessToken');
    expect(tokens).toHaveProperty('refreshToken');
    expect(typeof tokens.accessToken).toBe('string');
    expect(typeof tokens.refreshToken).toBe('string');
  });

  it('access token contains userId, email, type access', () => {
    const tokens = generateTokens('user-1', 'test@example.com');
    const decoded = jwt.verify(tokens.accessToken, TEST_SECRET);
    expect(decoded.userId).toBe('user-1');
    expect(decoded.email).toBe('test@example.com');
    expect(decoded.type).toBe('access');
  });

  it('refresh token contains type refresh', () => {
    const tokens = generateTokens('user-1', 'test@example.com');
    const decoded = jwt.verify(tokens.refreshToken, TEST_REFRESH_SECRET);
    expect(decoded.type).toBe('refresh');
  });

  it('access token is valid JWT decodable with correct secret', () => {
    const tokens = generateTokens('user-1', 'test@example.com');
    expect(() => jwt.verify(tokens.accessToken, TEST_SECRET)).not.toThrow();
  });

  it('refresh token is valid JWT decodable with refresh secret', () => {
    const tokens = generateTokens('user-1', 'test@example.com');
    expect(() => jwt.verify(tokens.refreshToken, TEST_REFRESH_SECRET)).not.toThrow();
  });

  it('access token cannot be verified with refresh secret', () => {
    const tokens = generateTokens('user-1', 'test@example.com');
    expect(() => jwt.verify(tokens.accessToken, TEST_REFRESH_SECRET)).toThrow();
  });

  it('refresh token cannot be verified with access secret', () => {
    const tokens = generateTokens('user-1', 'test@example.com');
    expect(() => jwt.verify(tokens.refreshToken, TEST_SECRET)).toThrow();
  });

  it('access token has exp claim', () => {
    const tokens = generateTokens('user-1', 'test@example.com');
    const decoded = jwt.decode(tokens.accessToken);
    expect(decoded.exp).toBeDefined();
    expect(decoded.exp).toBeGreaterThan(decoded.iat);
  });
});

// ---------- validateJWT ----------
describe('validateJWT', () => {
  it('calls next() on valid token', () => {
    const token = jwt.sign({ userId: 'u1', email: 'a@b.com', type: 'access' }, TEST_SECRET, { expiresIn: '1h' });
    const { req, res, next } = mockReqResNext({ authorization: `Bearer ${token}` });
    validateJWT(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('sets req.user from token payload', () => {
    const token = jwt.sign({ userId: 'u1', email: 'a@b.com', type: 'access' }, TEST_SECRET, { expiresIn: '1h' });
    const { req, res, next } = mockReqResNext({ authorization: `Bearer ${token}` });
    validateJWT(req, res, next);
    expect(req.user.userId).toBe('u1');
    expect(req.user.email).toBe('a@b.com');
  });

  it('returns 401 when no token provided', () => {
    const { req, res, next } = mockReqResNext({});
    validateJWT(req, res, next);
    expect(res._status).toBe(401);
    expect(res._json.code).toBe('TOKEN_REQUIRED');
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for invalid token', () => {
    const { req, res, next } = mockReqResNext({ authorization: 'Bearer not-a-real-jwt' });
    validateJWT(req, res, next);
    expect(res._status).toBe(401);
    expect(res._json.code).toBe('TOKEN_INVALID');
  });

  it('returns 401 with TOKEN_EXPIRED for expired token', () => {
    // Create a token that is already expired by using a negative expiresIn is not valid,
    // so we manually create a token with an exp in the past
    const payload = { userId: 'u1', email: 'a@b.com', exp: Math.floor(Date.now() / 1000) - 10 };
    const token = jwt.sign(payload, TEST_SECRET);
    const { req, res, next } = mockReqResNext({ authorization: `Bearer ${token}` });
    validateJWT(req, res, next);
    expect(res._status).toBe(401);
    expect(res._json.code).toBe('TOKEN_EXPIRED');
  });

  it('returns 401 for token signed with wrong secret', () => {
    const token = jwt.sign({ userId: 'u1' }, 'wrong-secret', { expiresIn: '1h' });
    const { req, res, next } = mockReqResNext({ authorization: `Bearer ${token}` });
    validateJWT(req, res, next);
    expect(res._status).toBe(401);
    expect(res._json.code).toBe('TOKEN_INVALID');
  });

  it('extracts token from Bearer prefix', () => {
    const token = jwt.sign({ userId: 'u1', email: 'a@b.com' }, TEST_SECRET, { expiresIn: '1h' });
    const { req, res, next } = mockReqResNext({ authorization: `Bearer ${token}` });
    validateJWT(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.user.userId).toBe('u1');
  });

  it('rejects authorization header without Bearer prefix', () => {
    const token = jwt.sign({ userId: 'u1', email: 'a@b.com' }, TEST_SECRET, { expiresIn: '1h' });
    const { req, res, next } = mockReqResNext({ authorization: token });
    validateJWT(req, res, next);
    // Token without "Bearer " prefix is not extracted from header;
    // if no cookie is set either, this returns 401 TOKEN_REQUIRED
    expect(res._status).toBe(401);
  });

  it('returns 401 for empty authorization header', () => {
    const { req, res, next } = mockReqResNext({ authorization: '' });
    validateJWT(req, res, next);
    expect(res._status).toBe(401);
  });

  it('returns 401 for Bearer with no token value', () => {
    const { req, res, next } = mockReqResNext({ authorization: 'Bearer ' });
    validateJWT(req, res, next);
    expect(res._status).toBe(401);
  });
});
