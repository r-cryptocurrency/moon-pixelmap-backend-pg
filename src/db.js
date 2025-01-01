import dotenv from 'dotenv';
dotenv.config();
import { DB_CONFIG } from './config.js';
import pkg from 'pg';

const { Pool } = pkg;

const pool = new Pool(DB_CONFIG);

async function createTables() {
  try {
    const client = await pool.connect();

    const createEventsTableQuery = `
      CREATE TABLE IF NOT EXISTS events (
        id SERIAL PRIMARY KEY,
        block_number INTEGER,
        transaction_hash TEXT,
        event_type TEXT,
        args JSONB,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    const createPixelBlocksTableQuery = `
      CREATE TABLE IF NOT EXISTS pixel_blocks (
        id SERIAL PRIMARY KEY,
        x INTEGER,
        y INTEGER,
        uri TEXT,
        current_owner TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (x, y)
      );
    `;

    const createPixelBlockOwnersTableQuery = `
      CREATE TABLE IF NOT EXISTS pixel_block_owners (
        id SERIAL PRIMARY KEY,
        x INTEGER,
        y INTEGER,
        owner TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (x, y) REFERENCES pixel_blocks(x, y)
      );
    `;

    const createPixelBlockUriHistoryTableQuery = `
      CREATE TABLE IF NOT EXISTS pixel_block_uri_history (
        id SERIAL PRIMARY KEY,
        x INTEGER,
        y INTEGER,
        uri TEXT,
        owner TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (x, y) REFERENCES pixel_blocks(x, y)
      );
    `;

    const createTransactionsTableQuery = `
      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        block_number INTEGER,
        transaction_hash TEXT,
        from_address TEXT,
        to_address TEXT,
        value TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await client.query(createEventsTableQuery);
    await client.query(createPixelBlocksTableQuery);
    await client.query(createPixelBlockOwnersTableQuery);
    await client.query(createPixelBlockUriHistoryTableQuery);
    await client.query(createTransactionsTableQuery);

    client.release();
  } catch (err) {
    console.error('Error creating tables:', err);
  }
}


async function resetDatabase() {
  try {
    const client = await pool.connect();
    await client.query('DROP TABLE IF EXISTS events');
    await client.query('DROP TABLE IF EXISTS pixel_block_owners');
    await client.query('DROP TABLE IF EXISTS pixel_blocks');
    await client.query('DROP TABLE IF EXISTS pixel_block_uri_history');
    await client.query('DROP TABLE IF EXISTS transactions');
    client.release();
    console.log('Database reset successfully');
  } catch (err) {
    console.error('Error resetting database:', err);
  }
}

export { createTables, resetDatabase };