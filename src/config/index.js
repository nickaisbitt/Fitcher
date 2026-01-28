require('dotenv').config();

const config = {
  // Server
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  
  // Database
  DATABASE_URL: process.env.DATABASE_URL,
  
  // JWT
  JWT_SECRET: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '24h',
  REFRESH_TOKEN_EXPIRES_IN: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d',
  
  // Redis
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
  
  // Trading APIs
  DEFAULT_AI_MODEL: process.env.DEFAULT_AI_MODEL || 'anthropic/claude-3.5-sonnet',
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  KRAKEN_API_KEY: process.env.KRAKEN_API_KEY,
  KRAKEN_API_SECRET: process.env.KRAKEN_API_SECRET,
  BINANCE_API_KEY: process.env.BINANCE_API_KEY,
  BINANCE_API_SECRET: process.env.BINANCE_API_SECRET,
  COINBASE_API_KEY: process.env.COINBASE_API_KEY,
  COINBASE_API_SECRET: process.env.COINBASE_API_SECRET,
  
  // Security
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
  
  // Frontend
  FRONTEND_URL: process.env.FRONTEND_URL || '*',
  
  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL || 'info'
};

// Validate required environment variables
const requiredVars = ['DATABASE_URL'];
const missingVars = requiredVars.filter(varName => !config[varName]);

if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:', missingVars);
  if (config.NODE_ENV === 'production') {
    process.exit(1);
  } else {
    console.warn('⚠️  Running without required environment variables in development mode');
  }
}

module.exports = config;