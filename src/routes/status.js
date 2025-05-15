import { Router } from 'express';
import { pool } from '../utils/db.js';
import { getLastProcessedBlock } from '../utils/blockProcessor.js';
import { createChildLogger } from '../utils/logger.js'; // Import shared logger

const logger = createChildLogger('statusRoute'); // Use shared logger
const router = Router();

router.get('/', async (req, res) => {
  try {
    const dbClient = await pool.connect();
    let dbStatus = 'OK';
    let lastBlockDB;
    try {
      const dbResult = await dbClient.query('SELECT NOW() as now');
      lastBlockDB = dbResult.rows[0].now;
    } catch (dbErr) {
      dbStatus = 'Error';
      logger.error('Database query failed for status check:', { error: dbErr.message, stack: dbErr.stack });
    } finally {
      dbClient.release();
    }

    let lastProcessedBlock;
    try {
      lastProcessedBlock = await getLastProcessedBlock();
    } catch (blockErr) {
      logger.error('Failed to get last processed block for status check:', { error: blockErr.message, stack: blockErr.stack });
      lastProcessedBlock = 'Error fetching';
    }
    
    // Placeholder for blockchain provider status - in a real scenario, you might ping the provider
    const blockchainProviderStatus = 'OK'; // Assuming Alchemy/provider is fine if no direct errors recently

    res.json({
      service: 'moon-pixelmap-backend-pg',
      status: 'OK',
      timestamp: new Date().toISOString(),
      dependencies: {
        database: {
          status: dbStatus,
          lastQueried: lastBlockDB
        },
        blockchainProvider: {
          status: blockchainProviderStatus // e.g., Alchemy
        },
        eventProcessing: {
          lastProcessedBlock: lastProcessedBlock
        }
      }
    });
  } catch (err) {
    logger.error('Error in GET /api/status:', { error: err.message, stack: err.stack });
    res.status(500).json({ 
      service: 'moon-pixelmap-backend-pg',
      status: 'Error',
      error: 'Failed to retrieve status' 
    });
  }
});

export default router;