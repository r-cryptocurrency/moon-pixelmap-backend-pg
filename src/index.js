import dotenv from 'dotenv';
dotenv.config();
import { SERVER_CONFIG, DB_CONFIG } from './config.js';
import { createTables, resetDatabase } from './db.js';

import pkg from 'pg';
console.log('The DB_CONFIG is:', DB_CONFIG);
const { Pool } = pkg;

const pool = new Pool(DB_CONFIG);
import express from 'express';
import { processEventsFromLastBlock, processTransactionsFromLastBlock } from './blockProcessor.js';

const app = express();
const port = SERVER_CONFIG.port;

app.get('/', async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT * FROM events ORDER BY timestamp DESC');
    res.send(result.rows);
    client.release();
  } catch (err) {
    console.error(err);
    res.send('Error ' + err);
  }
});

app.listen(port, async () => {
  // Uncomment the following line to reset the database each time the server starts
  // await resetDatabase();
  // await createTables();
  await processEventsFromLastBlock();
 // await processTransactionsFromLastBlock();
  console.log(`Server is running on port ${port}`);
});