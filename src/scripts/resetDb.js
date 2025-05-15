import { resetDatabase, createTables, pool } from '../utils/db.js';
import logger from '../utils/logger.js'; // Import shared logger

async function main() {
  logger.info('Attempting to reset the database...');
  try {
    await resetDatabase();
    logger.info('Database reset successfully');
    logger.info('Attempting to create tables...');
    await createTables();
    logger.info('Tables created successfully');
    logger.info('Database reset and table creation completed.');
  } catch (error) {
    logger.error('Failed to reset and create tables:', { error: error.message, stack: error.stack });
  } finally {
    await pool.end(() => {
      logger.info('Database pool closed.');
    });
  }
}

main();
