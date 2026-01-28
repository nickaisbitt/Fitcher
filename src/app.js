const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
require('dotenv').config();

const config = require('./config');
const { errorHandler } = require('./middleware/errorHandler');
const { validateJWT } = require('./middleware/auth');
const logger = require('./utils/logger');

// Import routes
const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
const configRoutes = require('./routes/config');
const marketDataRoutes = require('./routes/marketData');
const tradingRoutes = require('./routes/trading');

// Import services
const database = require('./utils/database');
const redisClient = require('./utils/redis');
const marketDataController = require('./controllers/marketDataController');

const PORT = config.PORT;

// Create Express app
const app = express();
const server = createServer(app);

// Configure Socket.io
const io = new Server(server, {
  cors: {
    origin: config.FRONTEND_URL,
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Store io instance globally
app.set('io', io);

// Security middleware
app.use(helmet());
app.use(cors({
  origin: config.FRONTEND_URL,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static files
app.use(express.static(path.join(__dirname)));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: config.NODE_ENV
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api', validateJWT, apiRoutes);
app.use('/api/config', configRoutes);
app.use('/api/market', marketDataRoutes);
app.use('/api/trading', tradingRoutes);

// Socket.io connection handling
io.on('connection', (socket) => {
  logger.info(`Socket connected: ${socket.id}`);
  
  socket.on('disconnect', () => {
    logger.info(`Socket disconnected: ${socket.id}`);
  });
  
  socket.on('subscribe:prices', (data) => {
    socket.join('price-updates');
    logger.info(`Socket ${socket.id} subscribed to price updates`);
  });
  
  socket.on('unsubscribe:prices', () => {
    socket.leave('price-updates');
    logger.info(`Socket ${socket.id} unsubscribed from price updates`);
  });
});

// Error handling middleware
app.use(errorHandler);

// Initialize services and start server
async function startServer() {
  try {
    // Connect to database
    await database.connect();
    logger.info('✅ Database initialized');

    // Connect to Redis
    await redisClient.connect();
    logger.info('✅ Redis initialized');

    // Initialize market data controller
    await marketDataController.initialize();
    logger.info('✅ Market data controller initialized');

    // Start server
    server.listen(PORT, () => {
      logger.info(`🚀 Fitcher server running on port ${PORT}`);
      logger.info(`🌍 Environment: ${config.NODE_ENV}`);
      logger.info(`📊 WebSocket server ready`);
      logger.info(`📝 Health check: http://localhost:${PORT}/health`);
    });
  } catch (error) {
    logger.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  
  try {
    server.close(async () => {
      await redisClient.disconnect();
      await database.disconnect();
      logger.info('Process terminated gracefully');
      process.exit(0);
    });
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  
  try {
    server.close(async () => {
      await redisClient.disconnect();
      await database.disconnect();
      logger.info('Process terminated gracefully');
      process.exit(0);
    });
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
});

// Start server
startServer();

module.exports = { app, server, io };