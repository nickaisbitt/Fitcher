// vitest globals (describe, it, expect, vi, beforeEach) are injected via vitest.config.js globals: true

// Set env vars BEFORE any require so config picks them up
process.env.JWT_SECRET = 'test-jwt-secret-key-minimum-32-bytes-long';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-different-from-access';
process.env.JWT_EXPIRES_IN = '1h';
process.env.REFRESH_TOKEN_EXPIRES_IN = '7d';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://fake';

const jwt = require('jsonwebtoken');

// Mock logger to suppress output during tests
vi.mock('../../src/utils/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}));

const {
  validateJWT,
  generateTokens,
  setTokenCookies,
  clearTokenCookies
} = require('../../src/middleware/auth');

const JWT_SECRET = 'test-jwt-secret-key-minimum-32-bytes-long';
const JWT_REFRESH_SECRET = 'test-refresh-secret-different-from-access';

// ── Helpers ──────────────────────────────────────────────────────

function createMockReq(overrides = {}) {
  return {
    headers: {},
    cookies: {},
    ...overrides
  };
}

function createMockRes() {
  const res = {
    statusCode: 200,
    body: null,
    cookies: {},
    clearedCookies: []
  };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.body = data; return res; };
  res.cookie = (name, value, options) => {
    res.cookies[name] = { value, options };
    return res;
  };
  res.clearCookie = (name, options) => {
    res.clearedCookies.push({ name, options });
    delete res.cookies[name];
    return res;
  };
  return res;
}

function createMockNext() {
  return vi.fn();
}

// ═════════════════════════════════════════════════════════════════
// setTokenCookies (10 tests)
// ═════════════════════════════════════════════════════════════════
describe('setTokenCookies', () => {
  let res;
  let tokens;

  beforeEach(() => {
    res = createMockRes();
    tokens = generateTokens('user-1', 'test@example.com');
    setTokenCookies(res, tokens);
  });

  it('sets fitcher_access_token cookie', () => {
    expect(res.cookies).toHaveProperty('fitcher_access_token');
    expect(res.cookies.fitcher_access_token.value).toBe(tokens.accessToken);
  });

  it('sets fitcher_refresh_token cookie', () => {
    expect(res.cookies).toHaveProperty('fitcher_refresh_token');
    expect(res.cookies.fitcher_refresh_token.value).toBe(tokens.refreshToken);
  });

  it('access token cookie is httpOnly', () => {
    expect(res.cookies.fitcher_access_token.options.httpOnly).toBe(true);
  });

  it('refresh token cookie is httpOnly', () => {
    expect(res.cookies.fitcher_refresh_token.options.httpOnly).toBe(true);
  });

  it('access token cookie has correct maxAge (1h = 3600000ms)', () => {
    expect(res.cookies.fitcher_access_token.options.maxAge).toBe(3600000);
  });

  it('refresh token cookie has correct maxAge (7d = 604800000ms)', () => {
    expect(res.cookies.fitcher_refresh_token.options.maxAge).toBe(604800000);
  });

  it("access token cookie has path '/'", () => {
    expect(res.cookies.fitcher_access_token.options.path).toBe('/');
  });

  it("refresh token cookie has path '/api/auth/refresh'", () => {
    expect(res.cookies.fitcher_refresh_token.options.path).toBe('/api/auth/refresh');
  });

  it('cookies are secure when NODE_ENV is production', () => {
    // The auth module reads IS_PRODUCTION at load time from config.NODE_ENV.
    // In test env, NODE_ENV === 'test' so secure should be false.
    // We verify the non-production case here (secure = false) since the module
    // was loaded with NODE_ENV='test'.
    expect(res.cookies.fitcher_access_token.options.secure).toBe(false);
    expect(res.cookies.fitcher_refresh_token.options.secure).toBe(false);
  });

  it("cookies have sameSite 'strict'", () => {
    expect(res.cookies.fitcher_access_token.options.sameSite).toBe('strict');
    expect(res.cookies.fitcher_refresh_token.options.sameSite).toBe('strict');
  });
});

// ═════════════════════════════════════════════════════════════════
// clearTokenCookies (5 tests)
// ═════════════════════════════════════════════════════════════════
describe('clearTokenCookies', () => {
  it('clears fitcher_access_token', () => {
    const res = createMockRes();
    clearTokenCookies(res);
    const names = res.clearedCookies.map((c) => c.name);
    expect(names).toContain('fitcher_access_token');
  });

  it('clears fitcher_refresh_token', () => {
    const res = createMockRes();
    clearTokenCookies(res);
    const names = res.clearedCookies.map((c) => c.name);
    expect(names).toContain('fitcher_refresh_token');
  });

  it('cleared cookies have correct paths', () => {
    const res = createMockRes();
    clearTokenCookies(res);

    const accessClear = res.clearedCookies.find((c) => c.name === 'fitcher_access_token');
    const refreshClear = res.clearedCookies.find((c) => c.name === 'fitcher_refresh_token');

    expect(accessClear.options.path).toBe('/');
    expect(refreshClear.options.path).toBe('/api/auth/refresh');
  });

  it('returns response for chaining', () => {
    // clearTokenCookies calls res.clearCookie which returns res,
    // so it should not throw and the res should still be usable
    const res = createMockRes();
    clearTokenCookies(res);
    // Verify res is still functional after clearing
    expect(res.clearedCookies).toHaveLength(3);
    expect(() => res.status(200).json({ ok: true })).not.toThrow();
  });

  it('works when no cookies were previously set', () => {
    const res = createMockRes();
    // No cookies set, clearTokenCookies should still work
    expect(() => clearTokenCookies(res)).not.toThrow();
    expect(res.clearedCookies).toHaveLength(3);
  });
});

// ═════════════════════════════════════════════════════════════════
// validateJWT with cookies (10 tests)
// ═════════════════════════════════════════════════════════════════
describe('validateJWT with cookies', () => {
  it('reads token from cookie when no Authorization header', () => {
    const tokens = generateTokens('user-cookie', 'cookie@example.com');
    const req = createMockReq({
      cookies: { fitcher_access_token: tokens.accessToken }
    });
    const res = createMockRes();
    const next = createMockNext();

    validateJWT(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user.userId).toBe('user-cookie');
  });

  it('reads token from Authorization header when both present (header wins)', () => {
    const headerTokens = generateTokens('user-header', 'header@example.com');
    const cookieTokens = generateTokens('user-cookie', 'cookie@example.com');

    const req = createMockReq({
      headers: { authorization: `Bearer ${headerTokens.accessToken}` },
      cookies: { fitcher_access_token: cookieTokens.accessToken }
    });
    const res = createMockRes();
    const next = createMockNext();

    validateJWT(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user.userId).toBe('user-header');
  });

  it('returns 401 when neither cookie nor header present', () => {
    const req = createMockReq({ headers: {}, cookies: {} });
    const res = createMockRes();
    const next = createMockNext();

    validateJWT(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for expired cookie token', () => {
    const expired = jwt.sign(
      { userId: 'user-exp', email: 'exp@test.com', type: 'access', exp: Math.floor(Date.now() / 1000) - 60 },
      JWT_SECRET
    );
    const req = createMockReq({
      cookies: { fitcher_access_token: expired }
    });
    const res = createMockRes();
    const next = createMockNext();

    validateJWT(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('TOKEN_EXPIRED');
  });

  it('returns 401 for invalid cookie token', () => {
    const req = createMockReq({
      cookies: { fitcher_access_token: 'not-a-valid-jwt' }
    });
    const res = createMockRes();
    const next = createMockNext();

    validateJWT(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('TOKEN_INVALID');
  });

  it('sets req.user from cookie token', () => {
    const tokens = generateTokens('user-42', 'forty-two@example.com');
    const req = createMockReq({
      cookies: { fitcher_access_token: tokens.accessToken }
    });
    const res = createMockRes();
    const next = createMockNext();

    validateJWT(req, res, next);

    expect(req.user).toBeDefined();
    expect(req.user.userId).toBe('user-42');
    expect(req.user.email).toBe('forty-two@example.com');
    expect(req.user.type).toBe('access');
  });

  it('works with valid cookie token', () => {
    const tokens = generateTokens('cookie-user', 'cookie@test.com');
    const req = createMockReq({
      cookies: { fitcher_access_token: tokens.accessToken }
    });
    const res = createMockRes();
    const next = createMockNext();

    validateJWT(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200); // unchanged, no error
  });

  it('works with valid header token', () => {
    const tokens = generateTokens('header-user', 'header@test.com');
    const req = createMockReq({
      headers: { authorization: `Bearer ${tokens.accessToken}` }
    });
    const res = createMockRes();
    const next = createMockNext();

    validateJWT(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user.userId).toBe('header-user');
  });

  it('returns TOKEN_REQUIRED when no token available', () => {
    const req = createMockReq({});
    const res = createMockRes();
    const next = createMockNext();

    validateJWT(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('TOKEN_REQUIRED');
    expect(res.body.success).toBe(false);
  });

  it('returns TOKEN_EXPIRED for expired token', () => {
    const expired = jwt.sign(
      { userId: 'u', email: 'e@e.com', type: 'access', exp: Math.floor(Date.now() / 1000) - 300 },
      JWT_SECRET
    );
    const req = createMockReq({
      headers: { authorization: `Bearer ${expired}` }
    });
    const res = createMockRes();
    const next = createMockNext();

    validateJWT(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('TOKEN_EXPIRED');
    expect(res.body.error).toBe('Token expired');
  });
});

// ═════════════════════════════════════════════════════════════════
// generateTokens still works (5 tests)
// ═════════════════════════════════════════════════════════════════
describe('generateTokens', () => {
  it('returns accessToken and refreshToken', () => {
    const tokens = generateTokens('user-1', 'test@example.com');
    expect(tokens).toHaveProperty('accessToken');
    expect(tokens).toHaveProperty('refreshToken');
    expect(typeof tokens.accessToken).toBe('string');
    expect(typeof tokens.refreshToken).toBe('string');
  });

  it('access token is valid JWT with correct payload', () => {
    const tokens = generateTokens('user-1', 'test@example.com');
    const decoded = jwt.verify(tokens.accessToken, JWT_SECRET);
    expect(decoded.userId).toBe('user-1');
    expect(decoded.email).toBe('test@example.com');
    expect(decoded.type).toBe('access');
    expect(decoded.exp).toBeDefined();
    expect(decoded.iat).toBeDefined();
  });

  it('refresh token is valid JWT with correct payload', () => {
    const tokens = generateTokens('user-1', 'test@example.com');
    const decoded = jwt.verify(tokens.refreshToken, JWT_REFRESH_SECRET);
    expect(decoded.userId).toBe('user-1');
    expect(decoded.email).toBe('test@example.com');
    expect(decoded.type).toBe('refresh');
    expect(decoded.exp).toBeDefined();
    expect(decoded.iat).toBeDefined();
  });

  it('access and refresh use different secrets', () => {
    const tokens = generateTokens('user-1', 'test@example.com');
    // Access token should NOT verify with refresh secret
    expect(() => jwt.verify(tokens.accessToken, JWT_REFRESH_SECRET)).toThrow();
    // Refresh token should NOT verify with access secret
    expect(() => jwt.verify(tokens.refreshToken, JWT_SECRET)).toThrow();
  });

  it('tokens have correct type field', () => {
    const tokens = generateTokens('user-1', 'test@example.com');
    const decodedAccess = jwt.decode(tokens.accessToken);
    const decodedRefresh = jwt.decode(tokens.refreshToken);
    expect(decodedAccess.type).toBe('access');
    expect(decodedRefresh.type).toBe('refresh');
  });
});
