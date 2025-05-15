import pg from 'pg'
import logger from './logger.js'; // Import shared logger
const { Pool } = pg

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'moonplace',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 5432
})


async function createTables() {
  try {
    const client = await pool.connect();

    const createEventsTableQuery = `
      CREATE TABLE IF NOT EXISTS events (
        id SERIAL PRIMARY KEY,
        block_number INTEGER,
        transaction_hash TEXT,
        log_index INTEGER, -- Added log_index
        event_type TEXT,
        args JSONB,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (transaction_hash, log_index) -- Added UNIQUE constraint
      );
    `;

    const createPixelBlocksTableQuery = `
      CREATE TABLE IF NOT EXISTS pixel_blocks (
        id SERIAL PRIMARY KEY,
        x INTEGER,
        y INTEGER,
        uri TEXT,
        current_owner TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- Timestamp of the last event affecting this block
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- Timestamp of initial creation (first event)
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- Timestamp of last update to this row in the DB
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
        transaction_hash TEXT, -- Added transaction_hash
        block_number INTEGER, -- Added block_number
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
        transaction_hash TEXT, -- Added transaction_hash
        block_number INTEGER, -- Added block_number
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

    const createUsersTableQuery = `
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        address TEXT UNIQUE NOT NULL, -- Ethereum address
        user_name TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await client.query(createEventsTableQuery);
    await client.query(createPixelBlocksTableQuery);
    await client.query(createPixelBlockOwnersTableQuery);
    await client.query(createPixelBlockUriHistoryTableQuery);
    await client.query(createTransactionsTableQuery);
    await client.query(createUsersTableQuery); // Added users table creation

    // Create trigger function to update the updated_at column
    const createTriggerFunctionQuery = `
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `;

    // Create trigger to update the updated_at column before update
    const createTriggerQuery = `
      CREATE TRIGGER update_pixel_blocks_updated_at
      BEFORE UPDATE ON pixel_blocks
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
    `;

    // Create trigger for users table
    const createUsersTriggerQuery = `
      CREATE TRIGGER update_users_updated_at
      BEFORE UPDATE ON users
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
    `;

    await client.query(createTriggerFunctionQuery);
    await client.query(createTriggerQuery); // For pixel_blocks
    await client.query(createUsersTriggerQuery); // For users

    client.release();
    logger.info('Tables created successfully');
  } catch (err) {
    logger.error('Error creating tables:', { error: err.message, stack: err.stack });
  }
}

async function resetDatabase() {
  try {
    const client = await pool.connect();
    await client.query('DROP TABLE IF EXISTS pixel_block_uri_history CASCADE');
    await client.query('DROP TABLE IF EXISTS pixel_block_owners CASCADE');
    await client.query('DROP TABLE IF EXISTS pixel_blocks CASCADE');
    await client.query('DROP TABLE IF EXISTS events CASCADE');
    await client.query('DROP TABLE IF EXISTS transactions CASCADE');
    await client.query('DROP TABLE IF EXISTS users CASCADE'); // Added users table drop
    client.release();
    logger.info('Database reset successfully');
  } catch (err) {
    logger.error('Error resetting database:', { error: err.message, stack: err.stack });
  }
}

export async function getPixelBlocks() {
  try {
    const result = await pool.query(`
      SELECT x, y, uri, color 
      FROM pixel_blocks 
      WHERE uri IS NOT NULL
    `);
    return result.rows;
  } catch (err) {
    logger.error('Error fetching pixel blocks:', { error: err.message, stack: err.stack });
    throw err;
  }
}

export { pool, createTables, resetDatabase };