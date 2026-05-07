const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

// Attach a unique request ID to every request
const requestId = (req, res, next) => {
  req.id = req.headers['x-request-id'] || uuidv4();
  res.setHeader('X-Request-Id', req.id);
  next();
};

// Global error handler middleware
const errorHandler = (err, req, res, next) => {
  const reqId = req.id || 'unknown';

  logger.error(`[${reqId}] Unhandled error:`, {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip
  });

  const status = err.status || 500;
  const isDevelopment = process.env.NODE_ENV === 'development';

  // Never leak stack traces or internal error messages in non-development environments
  const response = {
    success: false,
    error: isDevelopment ? err.message : 'Internal server error',
    requestId: reqId
  };

  if (isDevelopment) {
    response.stack = err.stack;
  }

  res.status(status).json(response);
};

// Async error wrapper
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = { errorHandler, asyncHandler, requestId };