const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 3000;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const mimeTypes = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

const clientConfig = {
  DEFAULT_AI_MODEL: process.env.DEFAULT_AI_MODEL || 'anthropic/claude-3.5-sonnet',
  APP_ENV: process.env.NODE_ENV || 'development'
};

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
const ALGORITHM = 'aes-256-gcm';

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const key = Buffer.from(ENCRYPTION_KEY.slice(0, 64), 'hex');
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return iv.toString('hex') + ':' + authTag + ':' + encrypted;
}

function decrypt(encryptedData) {
  try {
    const parts = encryptedData.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    const key = Buffer.from(ENCRYPTION_KEY.slice(0, 64), 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) { return null; }
}

const sessions = new Map();
function createSession(userId) {
  const sessionId = uuidv4();
  sessions.set(sessionId, { userId, expiresAt: Date.now() + 86400000 });
  return sessionId;
}
function getSession(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) return null;
  if (Date.now() > s.expiresAt) { sessions.delete(sessionId); return null; }
  return s;
}
function destroySession(sessionId) { sessions.delete(sessionId); }


// Initialize database tables
async function initDatabase() {
    const createTables = `
        CREATE TABLE IF NOT EXISTS users (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    email VARCHAR(255) UNIQUE NOT NULL,
                          password_hash VARCHAR(255) NOT NULL,
                                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                                    );
                                        CREATE TABLE IF NOT EXISTS api_keys (
                                              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                                    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                                                          exchange VARCHAR(50) NOT NULL,
                                                                api_key_encrypted TEXT NOT NULL,
                                                                      api_secret_encrypted TEXT NOT NULL,
                                                                            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                                                                                );
                                                                                    CREATE TABLE IF NOT EXISTS portfolios (
                                                                                          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                                                                                user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                                                                                                      data JSONB DEFAULT '{}',
                                                                                                            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                                                                                                                );
                                                                                                                    CREATE TABLE IF NOT EXISTS trades (
                                                                                                                          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                                                                                                                user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                                                                                                                                      exchange VARCHAR(50),
                                                                                                                                            pair VARCHAR(20),
                                                                                                                                                  side VARCHAR(10),
                                                                                                                                                        amount DECIMAL,
                                                                                                                                                              price DECIMAL,
                                                                                                                                                                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                                                                                                                                                                        );
                                                                                                                                                                            CREATE TABLE IF NOT EXISTS user_settings (
                                                                                                                                                                                  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                                                                                                                                                                        user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
                                                                                                                                                                                              settings JSONB DEFAULT '{}',
                                                                                                                                                                                                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                                                                                                                                                                                                        );
                                                                                                                                                                                                            CREATE TABLE IF NOT EXISTS watchlists (
                                                                                                                                                                                                                  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                                                                                                                                                                                                        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                                                                                                                                                                                                                              pairs JSONB DEFAULT '[]',
                                                                                                                                                                                                                                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                                                                                                                                                                                                                                        );
                                                                                                                                                                                                                                            CREATE TABLE IF NOT EXISTS alerts (
                                                                                                                                                                                                                                                  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                                                                                                                                                                                                                                        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                                                                                                                                                                                                                                                              pair VARCHAR(20),
                                                                                                                                                                                                                                                                    condition VARCHAR(50),
                                                                                                                                                                                                                                                                          price DECIMAL,
                                                                                                                                                                                                                                                                                active BOOLEAN DEFAULT true,
                                                                                                                                                                                                                                                                                      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                                                                                                                                                                                                                                                                                          );
                                                                                                                                                                                                                                                                                            `;
    try {
          await pool.query(createTables);
          console.log('Database tables initialized');
    } catch (err) {
          console.error('Database init error:', err.message);
    }
}

// Helper functions
function parseBody(req) {
    return new Promise((resolve) => {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', () => {
                  try { resolve(JSON.parse(body)); }
                  catch { resolve({}); }
          });
    });
}

function parseCookies(req) {
    const cookies = {};
    (req.headers.cookie || '').split(';').forEach(c => {
          const [k, v] = c.trim().split('=');
          if (k) cookies[k] = v;
    });
    return cookies;
}

function getAuthUser(req) {
    const cookies = parseCookies(req);
    if (!cookies.session) return null;
    return getSession(cookies.session);
}

function sendJSON(res, data, status = 200) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

// API Routes
const apiRoutes = {
    'POST /api/signup': async (req, res) => {
          const { email, password } = await parseBody(req);
          if (!email || !password) return sendJSON(res, { error: 'Email and password required' }, 400);
          try {
                  const hash = await bcrypt.hash(password, 12);
                  const result = await pool.query('INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email', [email, hash]);
                  const sessionId = createSession(result.rows[0].id);
                  res.setHeader('Set-Cookie', 'session=' + sessionId + '; HttpOnly; Path=/; Max-Age=86400');
                  sendJSON(res, { user: result.rows[0] });
          } catch (err) {
                  sendJSON(res, { error: err.code === '23505' ? 'Email exists' : 'Signup failed' }, 400);
          }
    },
    'POST /api/login': async (req, res) => {
          const { email, password } = await parseBody(req);
          try {
                  const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
                  if (!result.rows[0] || !await bcrypt.compare(password, result.rows[0].password_hash)) {
                            return sendJSON(res, { error: 'Invalid credentials' }, 401);
                  }
                  const sessionId = createSession(result.rows[0].id);
                  res.setHeader('Set-Cookie', 'session=' + sessionId + '; HttpOnly; Path=/; Max-Age=86400');
                  sendJSON(res, { user: { id: result.rows[0].id, email: result.rows[0].email } });
          } catch (err) {
                  sendJSON(res, { error: 'Login failed' }, 500);
          }
    },
    'POST /api/logout': async (req, res) => {
          const cookies = parseCookies(req);
          if (cookies.session) destroySession(cookies.session);
          res.setHeader('Set-Cookie', 'session=; HttpOnly; Path=/; Max-Age=0');
          sendJSON(res, { success: true });
    },
    'GET /api/me': async (req, res) => {
          const session = getAuthUser(req);
          if (!session) return sendJSON(res, { error: 'Not authenticated' }, 401);
          const result = await pool.query('SELECT id, email FROM users WHERE id = $1', [session.userId]);
          sendJSON(res, { user: result.rows[0] || null });
    },

    'POST /api/keys': async (req, res) => {
          const session = getAuthUser(req);
          if (!session) return sendJSON(res, { error: 'Not authenticated' }, 401);
          const { exchange, apiKey, apiSecret } = await parseBody(req);
          try {
                  await pool.query('INSERT INTO api_keys (user_id, exchange, api_key_encrypted, api_secret_encrypted) VALUES ($1, $2, $3, $4)', 
                                           [session.userId, exchange, encrypt(apiKey), encrypt(apiSecret)]);
                  sendJSON(res, { success: true });
          } catch (err) {
                  sendJSON(res, { error: 'Failed to save keys' }, 500);
          }
    },
    'GET /api/keys': async (req, res) => {
          const session = getAuthUser(req);
          if (!session) return sendJSON(res, { error: 'Not authenticated' }, 401);
          const result = await pool.query('SELECT id, exchange, created_at FROM api_keys WHERE user_id = $1', [session.userId]);
          sendJSON(res, { keys: result.rows });
    },
    'DELETE /api/keys': async (req, res) => {
          const session = getAuthUser(req);
          if (!session) return sendJSON(res, { error: 'Not authenticated' }, 401);
          const { id } = await parseBody(req);
          await pool.query('DELETE FROM api_keys WHERE id = $1 AND user_id = $2', [id, session.userId]);
          sendJSON(res, { success: true });
    },

    'POST /api/trades': async (req, res) => {
          const session = getAuthUser(req);
          if (!session) return sendJSON(res, { error: 'Not authenticated' }, 401);
          const { exchange, pair, side, amount, price } = await parseBody(req);
          await pool.query('INSERT INTO trades (user_id, exchange, pair, side, amount, price) VALUES ($1, $2, $3, $4, $5, $6)',
                                 [session.userId, exchange, pair, side, amount, price]);
          sendJSON(res, { success: true });
    },
    'GET /api/trades': async (req, res) => {
          const session = getAuthUser(req);
          if (!session) return sendJSON(res, { error: 'Not authenticated' }, 401);
          const result = await pool.query('SELECT * FROM trades WHERE user_id = $1 ORDER BY timestamp DESC LIMIT 100', [session.userId]);
          sendJSON(res, { trades: result.rows });
    },
    'GET /api/settings': async (req, res) => {
          const session = getAuthUser(req);
          if (!session) return sendJSON(res, { error: 'Not authenticated' }, 401);
          const result = await pool.query('SELECT settings FROM user_settings WHERE user_id = $1', [session.userId]);
          sendJSON(res, { settings: result.rows[0]?.settings || {} });
    },
    'POST /api/settings': async (req, res) => {
          const session = getAuthUser(req);
          if (!session) return sendJSON(res, { error: 'Not authenticated' }, 401);
          const { settings } = await parseBody(req);
          await pool.query('INSERT INTO user_settings (user_id, settings) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET settings = $2, updated_at = CURRENT_TIMESTAMP',
                                 [session.userId, JSON.stringify(settings)]);
          sendJSON(res, { success: true });
    },

    'GET /api/watchlist': async (req, res) => {
          const session = getAuthUser(req);
          if (!session) return sendJSON(res, { error: 'Not authenticated' }, 401);
          const result = await pool.query('SELECT pairs FROM watchlists WHERE user_id = $1', [session.userId]);
          sendJSON(res, { pairs: result.rows[0]?.pairs || [] });
    },
    'POST /api/watchlist': async (req, res) => {
          const session = getAuthUser(req);
          if (!session) return sendJSON(res, { error: 'Not authenticated' }, 401);
          const { pairs } = await parseBody(req);
          await pool.query('INSERT INTO watchlists (user_id, pairs) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET pairs = $2, updated_at = CURRENT_TIMESTAMP',
                                 [session.userId, JSON.stringify(pairs)]);
          sendJSON(res, { success: true });
    },
    'GET /api/alerts': async (req, res) => {
          const session = getAuthUser(req);
          if (!session) return sendJSON(res, { error: 'Not authenticated' }, 401);
          const result = await pool.query('SELECT * FROM alerts WHERE user_id = $1', [session.userId]);
          sendJSON(res, { alerts: result.rows });
    },
    'POST /api/alerts': async (req, res) => {
          const session = getAuthUser(req);
          if (!session) return sendJSON(res, { error: 'Not authenticated' }, 401);
          const { pair, condition, price } = await parseBody(req);
          await pool.query('INSERT INTO alerts (user_id, pair, condition, price) VALUES ($1, $2, $3, $4)', [session.userId, pair, condition, price]);
          sendJSON(res, { success: true });
    },
    'DELETE /api/alerts': async (req, res) => {
          const session = getAuthUser(req);
          if (!session) return sendJSON(res, { error: 'Not authenticated' }, 401);
          const { id } = await parseBody(req);
          await pool.query('DELETE FROM alerts WHERE id = $1 AND user_id = $2', [id, session.userId]);
          sendJSON(res, { success: true });
    },
    'GET /api/config': async (req, res) => {
          sendJSON(res, { config: clientConfig });
    }
};

// HTTP Server
const server = http.createServer(async (req, res) => {
    // CORS
                                   const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

                                   // API routes
                                   const routeKey = req.method + ' ' + req.url.split('?')[0];
    if (apiRoutes[routeKey]) {
          try { await apiRoutes[routeKey](req, res); }
          catch (err) { console.error(err); sendJSON(res, { error: 'Server error' }, 500); }
          return;
    }

                                   // Static files
                                   let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
    const ext = path.extname(filePath);
    if (!ext) filePath = path.join(__dirname, 'index.html');

                                   fs.readFile(filePath, (err, content) => {
                                         if (err) {
                                                 fs.readFile(path.join(__dirname, 'index.html'), (e, c) => {
                                                           res.writeHead(e ? 404 : 200, { 'Content-Type': 'text/html' });
                                                           res.end(e ? 'Not Found' : c);
                                                 });
                                         } else {
                                                 res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
                                                 res.end(content);
                                         }
                                   });
});

// Start server
initDatabase().then(() => {
    server.listen(PORT, () => console.log('Fitcher running on port ' + PORT));
});
