import dotenv from 'dotenv';
dotenv.config();
import { createTables, resetDatabase, pool } from './utils/db.js';
import express from 'express';
import cors from 'cors';
import { processEventsFromLastBlock, processTransactionsFromLastBlock } from './utils/blockProcessor.js';
import logger from './utils/logger.js'; // Import shared logger

// Import route handlers
import statusRouter from './routes/status.js';
import pixelmapRouter from './routes/pixelmap.js';
import pixelsRouter from './routes/pixels.js';
import usersRouter from './routes/users.js';

const app = express();
const port = process.env.PORT || 4321; // Use port 4321 to match frontend config

// CORS setup - allow all origins in development
app.use(cors({
  origin: '*', // Allow all origins in development
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: false, // Changed to false as we're using "*" for origin
  exposedHeaders: ['Content-Type', 'Content-Length']
}));

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

app.use(express.json());

// Import the new pixels-update route
import pixelsUpdateRouter from './routes/pixels-update.js';

// Route handlers with correct paths
app.use('/api/status', statusRouter);
app.use('/api/pixelmap', pixelmapRouter);
app.use('/api/pixels', pixelsRouter);
app.use('/api/users', usersRouter);
app.use('/api/pixels-update', pixelsUpdateRouter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Database connection test
async function testDbConnection() {
  try {
    await pool.query('SELECT NOW()');
    logger.info('Database connection successful');
    return true;
  } catch (err) {
    logger.error('Database connection failed:', { error: err.message, stack: err.stack });
    return false;
  }
}

app.listen(port, async () => {
  logger.info(`Attempting to start server on port ${port}...`);
  const dbConnected = await testDbConnection();
  if (!dbConnected) {
    logger.error('Server startup failed: No database connection. Exiting.');
    process.exit(1);
  }
  try {
    // logger.info('Running startup sequence: resetDatabase and createTables...');
    // await resetDatabase(); // Typically not run on every start in production
    // await createTables();  // Typically not run on every start if migrations are handled otherwise
    // logger.info('Startup sequence: Database setup complete.');
    // clearImageCache(); // Ensure clearImageCache is defined or imported if used

    logger.info('Starting event processing...');
    await processEventsFromLastBlock(); // This can take time, consider running as a background task or service
    // await processTransactionsFromLastBlock(); // Consider if this needs to run on startup or periodically

    logger.info(`Server running at http://localhost:${port}`);
  } catch (err) {
    logger.error('Startup error during event processing or server setup:', { error: err.message, stack: err.stack });
    process.exit(1);
  }
});