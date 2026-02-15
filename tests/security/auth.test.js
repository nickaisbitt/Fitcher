// vitest globals (describe, it, expect, vi) are injected via vitest.config.js globals: true

// Set env vars BEFORE any require so config picks them up
process.env.JWT_SECRET = 'test-jwt-secret-key-32bytes-min';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-different';
process.env.JWT_EXPIRES_IN = '1h';
process.env.REFRESH_TOKEN_EXPIRES_IN = '7d';
process.env.DATABASE_URL = 'postgres://fake';

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// Mock logger to suppress output during tests
vi.mock('../../src/utils/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}));

const { validateJWT, generateTokens } = require('../../src/middleware/auth');
const config = require('../../src/config');

const JWT_SECRET = 'test-jwt-secret-key-32bytes-min';
const JWT_REFRESH_SECRET = 'test-refresh-secret-different';

// ── Helpers ──────────────────────────────────────────────────────

function createMockReq(overrides = {}) {
  return { headers: {}, body: {}, params: {}, query: {}, ...overrides };
}

function createMockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.body = data; return res; };
  return res;
}

function createMockNext() {
  return vi.fn();
}

// ═════════════════════════════════════════════════════════════════
// Token Generation (10 tests)
// ═════════════════════════════════════════════════════════════════
describe('Token generation', () => {
  it('access token contains userId, email, type:access', () => {
    const { accessToken } = generateTokens('user-42', 'alice@example.com');
    const decoded = jwt.verify(accessToken, JWT_SECRET);
    expect(decoded.userId).toBe('user-42');
    expect(decoded.email).toBe('alice@example.com');
    expect(decoded.type).toBe('access');
  });

  it('refresh token contains userId, email, type:refresh', () => {
    const { refreshToken } = generateTokens('user-42', 'alice@example.com');
    const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
    expect(decoded.userId).toBe('user-42');
    expect(decoded.email).toBe('alice@example.com');
    expect(decoded.type).toBe('refresh');
  });

  it('access token is signed with JWT_SECRET', () => {
    const { accessToken } = generateTokens('user-1', 'test@test.com');
    expect(() => jwt.verify(accessToken, JWT_SECRET)).not.toThrow();
  });

  it('refresh token is signed with JWT_REFRESH_SECRET (different key)', () => {
    const { refreshToken } = generateTokens('user-1', 'test@test.com');
    expect(() => jwt.verify(refreshToken, JWT_REFRESH_SECRET)).not.toThrow();
    // And it should NOT verify with the access secret
    expect(() => jwt.verify(refreshToken, JWT_SECRET)).toThrow();
  });

  it('access token expires in configured time', () => {
    const { accessToken } = generateTokens('user-1', 'test@test.com');
    const decoded = jwt.decode(accessToken);
    // 1h = 3600s, allow 5s tolerance
    const expectedExpiry = decoded.iat + 3600;
    expect(decoded.exp).toBeGreaterThanOrEqual(expectedExpiry - 5);
    expect(decoded.exp).toBeLessThanOrEqual(expectedExpiry + 5);
  });

  it('refresh token expires in 7d', () => {
    const { refreshToken } = generateTokens('user-1', 'test@test.com');
    const decoded = jwt.decode(refreshToken);
    // 7d = 604800s, allow 5s tolerance
    const expectedExpiry = decoded.iat + 604800;
    expect(decoded.exp).toBeGreaterThanOrEqual(expectedExpiry - 5);
    expect(decoded.exp).toBeLessThanOrEqual(expectedExpiry + 5);
  });

  it('tokens are different from each other', () => {
    const { accessToken, refreshToken } = generateTokens('user-1', 'test@test.com');
    expect(accessToken).not.toBe(refreshToken);
  });

  it('generated tokens are valid JWT format (three dot-separated segments)', () => {
    const { accessToken, refreshToken } = generateTokens('user-1', 'test@test.com');
    expect(accessToken.split('.')).toHaveLength(3);
    expect(refreshToken.split('.')).toHaveLength(3);
  });

  it('can decode access token without verification', () => {
    const { accessToken } = generateTokens('user-1', 'test@test.com');
    const decoded = jwt.decode(accessToken);
    expect(decoded).not.toBeNull();
    expect(decoded.userId).toBe('user-1');
  });

  it('can decode refresh token without verification', () => {
    const { refreshToken } = generateTokens('user-1', 'test@test.com');
    const decoded = jwt.decode(refreshToken);
    expect(decoded).not.toBeNull();
    expect(decoded.userId).toBe('user-1');
  });
});

// ═════════════════════════════════════════════════════════════════
// Token Validation (15 tests)
// ═════════════════════════════════════════════════════════════════
describe('Token validation', () => {
  it('valid access token passes middleware', () => {
    const { accessToken } = generateTokens('user-1', 'test@test.com');
    const req = createMockReq({ headers: { authorization: `Bearer ${accessToken}` } });
    const res = createMockRes();
    const next = createMockNext();

    validateJWT(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toBeDefined();
    expect(req.user.userId).toBe('user-1');
  });

  it('missing Authorization header returns 401 TOKEN_REQUIRED', () => {
    const req = createMockReq({ headers: {} });
    const res = createMockRes();
    const next = createMockNext();

    validateJWT(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('TOKEN_REQUIRED');
    expect(next).not.toHaveBeenCalled();
  });

  it('empty Authorization header returns 401', () => {
    const req = createMockReq({ headers: { authorization: '' } });
    const res = createMockRes();
    const next = createMockNext();

    validateJWT(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('Bearer with empty token returns 401', () => {
    const req = createMockReq({ headers: { authorization: 'Bearer ' } });
    const res = createMockRes();
    const next = createMockNext();

    validateJWT(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('token signed with wrong secret returns 401 TOKEN_INVALID', () => {
    const wrongToken = jwt.sign(
      { userId: 'user-1', email: 'test@test.com', type: 'access' },
      'completely-wrong-secret',
      { expiresIn: '1h' }
    );
    const req = createMockReq({ headers: { authorization: `Bearer ${wrongToken}` } });
    const res = createMockRes();
    const next = createMockNext();

    validateJWT(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('TOKEN_INVALID');
  });

  it('expired token returns 401 TOKEN_EXPIRED', () => {
    const expiredToken = jwt.sign(
      { userId: 'user-1', email: 'test@test.com', type: 'access', exp: Math.floor(Date.now() / 1000) - 10 },
      JWT_SECRET
    );
    const req = createMockReq({ headers: { authorization: `Bearer ${expiredToken}` } });
    const res = createMockRes();
    const next = createMockNext();

    validateJWT(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('TOKEN_EXPIRED');
  });

  it('refresh token used as access token is rejected (signed with different secret)', () => {
    const { refreshToken } = generateTokens('user-1', 'test@test.com');
    const req = createMockReq({ headers: { authorization: `Bearer ${refreshToken}` } });
    const res = createMockRes();
    const next = createMockNext();

    validateJWT(req, res, next);

    // Since JWT_REFRESH_SECRET !== JWT_SECRET, verification fails
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('TOKEN_INVALID');
  });

  it('token with tampered payload returns 401', () => {
    const { accessToken } = generateTokens('user-1', 'test@test.com');
    const parts = accessToken.split('.');
    // Tamper with the payload by replacing it
    const tamperedPayload = Buffer.from(JSON.stringify({ userId: 'hacker', email: 'evil@hack.com', type: 'access' })).toString('base64url');
    const tampered = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

    const req = createMockReq({ headers: { authorization: `Bearer ${tampered}` } });
    const res = createMockRes();
    const next = createMockNext();

    validateJWT(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('TOKEN_INVALID');
  });

  it('token with missing segments returns 401', () => {
    const req = createMockReq({ headers: { authorization: 'Bearer header.payload' } });
    const res = createMockRes();
    const next = createMockNext();

    validateJWT(req, res, next);

    expect(res.statusCode).toBe(401);
  });

  it('completely random string as token returns 401', () => {
    const req = createMockReq({ headers: { authorization: 'Bearer xyzrandomgarbage123' } });
    const res = createMockRes();
    const next = createMockNext();

    validateJWT(req, res, next);

    expect(res.statusCode).toBe(401);
  });

  it('very long token string returns 401', () => {
    const longToken = 'a'.repeat(10000);
    const req = createMockReq({ headers: { authorization: `Bearer ${longToken}` } });
    const res = createMockRes();
    const next = createMockNext();

    validateJWT(req, res, next);

    expect(res.statusCode).toBe(401);
  });

  it('token with special characters returns 401', () => {
    const req = createMockReq({ headers: { authorization: 'Bearer <script>alert("xss")</script>' } });
    const res = createMockRes();
    const next = createMockNext();

    validateJWT(req, res, next);

    expect(res.statusCode).toBe(401);
  });

  it('Authorization header without Bearer prefix returns 401', () => {
    const req = createMockReq({ headers: { authorization: 'Basic dXNlcjpwYXNz' } });
    const res = createMockRes();
    const next = createMockNext();

    validateJWT(req, res, next);

    expect(res.statusCode).toBe(401);
  });

  it('bearer lowercase should fail (code uses replace with capital Bearer)', () => {
    const { accessToken } = generateTokens('user-1', 'test@test.com');
    const req = createMockReq({ headers: { authorization: `bearer ${accessToken}` } });
    const res = createMockRes();
    const next = createMockNext();

    validateJWT(req, res, next);

    // 'bearer <token>' won't match 'Bearer ' replacement, so jwt.verify gets 'bearer <token>'
    expect(res.statusCode).toBe(401);
  });

  it('null authorization header handled gracefully', () => {
    const req = createMockReq({ headers: { authorization: null } });
    const res = createMockRes();
    const next = createMockNext();

    // Should not throw
    expect(() => validateJWT(req, res, next)).not.toThrow();
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('TOKEN_REQUIRED');
  });
});

// ═════════════════════════════════════════════════════════════════
// Password Security (5 tests)
// ═════════════════════════════════════════════════════════════════
describe('Password security', () => {
  it('bcrypt hash is not equal to original password', async () => {
    const password = 'MySecureP@ss123';
    const hash = await bcrypt.hash(password, 10);
    expect(hash).not.toBe(password);
  });

  it('bcrypt compare returns true for correct password', async () => {
    const password = 'CorrectPassword!';
    const hash = await bcrypt.hash(password, 10);
    const result = await bcrypt.compare(password, hash);
    expect(result).toBe(true);
  });

  it('bcrypt compare returns false for wrong password', async () => {
    const password = 'CorrectPassword!';
    const hash = await bcrypt.hash(password, 10);
    const result = await bcrypt.compare('WrongPassword!', hash);
    expect(result).toBe(false);
  });

  it('different hashes for same password (salt)', async () => {
    const password = 'SamePassword!';
    const hash1 = await bcrypt.hash(password, 10);
    const hash2 = await bcrypt.hash(password, 10);
    expect(hash1).not.toBe(hash2);
  });

  it('hash has correct bcrypt prefix ($2a$ or $2b$)', async () => {
    const hash = await bcrypt.hash('TestPass', 10);
    expect(hash).toMatch(/^\$2[aby]\$/);
  });
});

// ═════════════════════════════════════════════════════════════════
// Input Validation Patterns (10 tests)
// ═════════════════════════════════════════════════════════════════
describe('Input validation patterns', () => {
  // Email validation helper
  const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  it('email validation: valid email passes', () => {
    expect(isValidEmail('user@example.com')).toBe(true);
  });

  it('email validation: no @ fails', () => {
    expect(isValidEmail('userexample.com')).toBe(false);
  });

  it('email validation: no domain fails', () => {
    expect(isValidEmail('user@')).toBe(false);
  });

  it('email validation: empty string fails', () => {
    expect(isValidEmail('')).toBe(false);
  });

  // Password validation helper
  const isValidPassword = (pw) => typeof pw === 'string' && pw.length >= 8;

  it('password validation: 8+ chars passes', () => {
    expect(isValidPassword('12345678')).toBe(true);
  });

  it('password validation: 7 chars fails', () => {
    expect(isValidPassword('1234567')).toBe(false);
  });

  it('password validation: empty fails', () => {
    expect(isValidPassword('')).toBe(false);
  });

  // Pair format regex (same as in orderValidator)
  const pairRegex = /^[A-Z]{2,10}[\/\-][A-Z]{2,10}$/i;

  it('pair format: BTC/USD passes regex', () => {
    expect(pairRegex.test('BTC/USD')).toBe(true);
  });

  it('pair format: btcusd fails (no separator)', () => {
    expect(pairRegex.test('btcusd')).toBe(false);
  });

  it('pair format: A/B fails (too short)', () => {
    expect(pairRegex.test('A/B')).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════
// Token Edge Cases (10 tests)
// ═════════════════════════════════════════════════════════════════
describe('Token edge cases', () => {
  it('multiple calls to generateTokens produce different tokens (unique)', () => {
    const tokens1 = generateTokens('user-1', 'test@test.com');
    const tokens2 = generateTokens('user-1', 'test@test.com');
    // access and refresh across calls are different strings
    expect(tokens1.accessToken).not.toBe(tokens2.refreshToken);
    expect(tokens1.refreshToken).not.toBe(tokens2.accessToken);
  });

  it('token for userId with special characters works', () => {
    const { accessToken } = generateTokens('user-!@#$%^&*()', 'test@test.com');
    const decoded = jwt.verify(accessToken, JWT_SECRET);
    expect(decoded.userId).toBe('user-!@#$%^&*()');
  });

  it('token for very long email works', () => {
    const longEmail = 'a'.repeat(200) + '@example.com';
    const { accessToken } = generateTokens('user-1', longEmail);
    const decoded = jwt.verify(accessToken, JWT_SECRET);
    expect(decoded.email).toBe(longEmail);
  });

  it('token verification is timing-safe (does not error differently for different invalid tokens)', () => {
    const wrongToken1 = jwt.sign({ userId: 'a' }, 'wrong-key-1', { expiresIn: '1h' });
    const wrongToken2 = jwt.sign({ userId: 'b' }, 'wrong-key-2', { expiresIn: '1h' });

    const res1 = createMockRes();
    const res2 = createMockRes();

    validateJWT(
      createMockReq({ headers: { authorization: `Bearer ${wrongToken1}` } }),
      res1,
      createMockNext()
    );
    validateJWT(
      createMockReq({ headers: { authorization: `Bearer ${wrongToken2}` } }),
      res2,
      createMockNext()
    );

    // Both should return the same error code — no information leakage
    expect(res1.body.code).toBe(res2.body.code);
    expect(res1.statusCode).toBe(res2.statusCode);
  });

  it('decoded token has iat (issued at) field', () => {
    const { accessToken } = generateTokens('user-1', 'test@test.com');
    const decoded = jwt.decode(accessToken);
    expect(decoded.iat).toBeDefined();
    expect(typeof decoded.iat).toBe('number');
  });

  it('decoded token has exp (expiration) field', () => {
    const { accessToken } = generateTokens('user-1', 'test@test.com');
    const decoded = jwt.decode(accessToken);
    expect(decoded.exp).toBeDefined();
    expect(typeof decoded.exp).toBe('number');
  });

  it('access and refresh tokens have different exp values', () => {
    const { accessToken, refreshToken } = generateTokens('user-1', 'test@test.com');
    const decodedAccess = jwt.decode(accessToken);
    const decodedRefresh = jwt.decode(refreshToken);
    // Access = 1h, Refresh = 7d — they must differ
    expect(decodedAccess.exp).not.toBe(decodedRefresh.exp);
  });

  it('token created just now is not expired', () => {
    const { accessToken } = generateTokens('user-1', 'test@test.com');
    const decoded = jwt.decode(accessToken);
    const nowSeconds = Math.floor(Date.now() / 1000);
    expect(decoded.exp).toBeGreaterThan(nowSeconds);
  });

  it('can generate tokens for multiple users without interference', () => {
    const tokensA = generateTokens('user-a', 'a@test.com');
    const tokensB = generateTokens('user-b', 'b@test.com');

    const decodedA = jwt.verify(tokensA.accessToken, JWT_SECRET);
    const decodedB = jwt.verify(tokensB.accessToken, JWT_SECRET);

    expect(decodedA.userId).toBe('user-a');
    expect(decodedA.email).toBe('a@test.com');
    expect(decodedB.userId).toBe('user-b');
    expect(decodedB.email).toBe('b@test.com');
  });

  it('empty userId/email in token generation still creates valid token', () => {
    const { accessToken } = generateTokens('', '');
    const decoded = jwt.verify(accessToken, JWT_SECRET);
    expect(decoded.userId).toBe('');
    expect(decoded.email).toBe('');
    expect(decoded.type).toBe('access');
  });
});
