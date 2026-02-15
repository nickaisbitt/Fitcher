const express = require('express');
const { body, query, validationResult } = require('express-validator');
const dataIngestionController = require('../controllers/dataIngestionController');
const { validateJWT } = require('../middleware/auth');

const router = express.Router();

// All data ingestion routes require authentication
router.use(validateJWT);

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array().map(e => e.msg)
    });
  }
  next();
};

// POST /api/data/ingest - Trigger data ingestion
router.post('/ingest',
  body('exchange').isString().isLength({ min: 2, max: 20 }).withMessage('Valid exchange name required'),
  body('pair').isString().matches(/^[A-Z]{2,10}[\/\-][A-Z]{2,10}$/i).withMessage('Invalid pair format'),
  body('timeframe').optional().isString().withMessage('Timeframe must be a string'),
  handleValidationErrors,
  dataIngestionController.ingest
);

// GET /api/data/status - Get data source status
router.get('/status', dataIngestionController.status);

// GET /api/data/gaps - Detect data gaps
router.get('/gaps',
  query('pair').optional().matches(/^[A-Z]{2,10}[\/\-][A-Z]{2,10}$/i).withMessage('Invalid pair format'),
  handleValidationErrors,
  dataIngestionController.gaps
);

// POST /api/data/repair - Repair gaps
router.post('/repair', dataIngestionController.repair);

// GET /api/data/read - Read historical data
router.get('/read',
  query('pair').isString().matches(/^[A-Z]{2,10}[\/\-][A-Z]{2,10}$/i).withMessage('Invalid pair format'),
  query('timeframe').optional().isString(),
  query('limit').optional().isInt({ min: 1, max: 10000 }).withMessage('Limit must be between 1 and 10000'),
  handleValidationErrors,
  dataIngestionController.read
);

// POST /api/data/prefetch - Pre-fetch common datasets
router.post('/prefetch', dataIngestionController.prefetch);

module.exports = router;
