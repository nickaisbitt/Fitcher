const express = require('express');
const dataIngestionController = require('../controllers/dataIngestionController');
const { validateJWT } = require('../middleware/auth');

const router = express.Router();

// All data ingestion routes require authentication
router.use(validateJWT);

// POST /api/data/ingest - Trigger data ingestion
router.post('/ingest', dataIngestionController.ingest);

// GET /api/data/status - Get data source status
router.get('/status', dataIngestionController.status);

// GET /api/data/gaps - Detect data gaps
router.get('/gaps', dataIngestionController.gaps);

// POST /api/data/repair - Repair gaps
router.post('/repair', dataIngestionController.repair);

// GET /api/data/read - Read historical data
router.get('/read', dataIngestionController.read);

// POST /api/data/prefetch - Pre-fetch common datasets
router.post('/prefetch', dataIngestionController.prefetch);

module.exports = router;
