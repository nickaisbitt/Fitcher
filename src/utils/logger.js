const winston = require('winston');
const path = require('path');

const transports = [];

// Only add file transports when not in test mode
// (iCloud-synced paths + large log files can cause hangs)
if (process.env.NODE_ENV !== 'test') {
  transports.push(
    new winston.transports.File({ filename: path.join(__dirname, '../../logs/error.log'), level: 'error' }),
    new winston.transports.File({ filename: path.join(__dirname, '../../logs/combined.log') })
  );
}

// Console transport for non-production
if (process.env.NODE_ENV !== 'production') {
  transports.push(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
      // In test mode, only show errors to avoid noisy output
      level: process.env.NODE_ENV === 'test' ? 'error' : undefined
    })
  );
}

// Fallback: at least one transport to avoid winston errors
if (transports.length === 0) {
  transports.push(new winston.transports.Console({ silent: true }));
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'fitcher-api' },
  transports,
});

module.exports = logger;