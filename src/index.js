import dotenv from 'dotenv';
dotenv.config();
import { createTables, resetDatabase, pool } from './utils/db.js';
import express from 'express';
import http from 'http';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { processEventsFromLastBlock, processTransactionsFromLastBlock } from './utils/blockProcessor.js';
import logger from './utils/logger.js'; // Import shared logger
import chatServer from './services/chatServer.js';

// Import route handlers
import statusRouter from './routes/status.js';
import pixelmapRouter from './routes/pixelmap.js';
import pixelsRouter from './routes/pixels.js';
import usersRouter from './routes/users.js';

const app = express();
const port = process.env.PORT || 4321; // Use port 4321 to match frontend config

// Trust proxy - required when behind nginx/reverse proxy
// This allows express-rate-limit to correctly identify users by IP
app.set('trust proxy', 1);

// Rate limiting configuration
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // Limit each IP to 300 requests per windowMs (increased for dev)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: { error: 'Too many requests, please try again later.' },
  handler: (req, res) => {
    logger.warn('Rate limit exceeded', { ip: req.ip, path: req.path });
    res.status(429).json({ error: 'Too many requests, please try again later.' });
  },
});

// Stricter rate limit for write operations (POST/PUT/DELETE)
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Limit each IP to 20 write requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many write requests, please try again later.' },
  handler: (req, res) => {
    logger.warn('Write rate limit exceeded', { ip: req.ip, path: req.path, method: req.method });
    res.status(429).json({ error: 'Too many write requests, please try again later.' });
  },
});

// CORS setup - allow all origins in development
app.use(cors({
  origin: '*', // Allow all origins in development
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: false, // Changed to false as we're using "*" for origin
  exposedHeaders: ['Content-Type', 'Content-Length']
}));

// Apply general rate limiter to all routes
app.use(limiter);

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

// Increase body size limit to 10MB for image uploads
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Import the new pixels-update route
import pixelsUpdateRouter from './routes/pixels-update.js';

// Route handlers with correct paths
app.use('/api/status', statusRouter);
app.use('/api/pixelmap', pixelmapRouter);
app.use('/api/pixels', pixelsRouter);
app.use('/api/users', usersRouter);
// Apply stricter rate limit to write operations
app.use('/api/pixels-update', writeLimiter, pixelsUpdateRouter);

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

// Create HTTP server to attach WebSocket
const server = http.createServer(app);

// Initialize WebSocket chat server
chatServer.initialize(server);

server.listen(port, async () => {
  logger.info(`Attempting to start server on port ${port}...`);
  const dbConnected = await testDbConnection();
  if (!dbConnected) {
    logger.error('Server startup failed: No database connection. Exiting.');
    process.exit(1);
  }
  try {
    logger.info('Starting event processing...');
    await processEventsFromLastBlock();

    logger.info(`Server running at http://localhost:${port}`);
    logger.info(`WebSocket chat available at ws://localhost:${port}/ws/chat`);
  } catch (err) {
    logger.error('Startup error during event processing or server setup:', { error: err.message, stack: err.stack });
    process.exit(1);
  }
});