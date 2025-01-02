import dotenv from 'dotenv';
dotenv.config();
import { SERVER_CONFIG, DB_CONFIG } from './config.js';
import { createTables, resetDatabase } from './db.js';

import pkg from 'pg';
console.log('The DB_CONFIG is:', DB_CONFIG);
const { Pool } = pkg;

const pool = new Pool(DB_CONFIG);
import express from 'express';
import { processEventsFromLastBlock, processTransactionsFromLastBlock } from './scripts/blockProcessor.js';

// Import route handlers
import statusRouter from './routes/status.js';
import pixelmapRouter from './routes/pixelmap.js';

const app = express();
const port = SERVER_CONFIG.port;

// Use route handlers
app.use('/', statusRouter);
app.use('/pixelmap', pixelmapRouter);

app.listen(port, async () => {
  // Uncomment the following line to reset the database each time the server starts
  await resetDatabase();
  await createTables();
  await processEventsFromLastBlock();
  // await processTransactionsFromLastBlock();
  console.log(`Server is running on port ${port}`);
});