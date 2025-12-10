import { Router } from 'express';
import { pool } from '../utils/db.js';
import { getLastProcessedBlock } from '../utils/blockProcessor.js';
import { getProviderStats, getBlockNumber } from '../utils/rpcProvider.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('statusRoute');
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
    
    // Get RPC provider status
    let rpcStatus = 'OK';
    let currentBlockNumber = null;
    const providerStats = getProviderStats();
    
    try {
      currentBlockNumber = await getBlockNumber();
    } catch (rpcErr) {
      rpcStatus = 'Error';
      logger.error('RPC provider failed for status check:', { error: rpcErr.message });
    }

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
          status: rpcStatus,
          currentEndpoint: providerStats.currentEndpoint,
          endpointIndex: `${providerStats.currentIndex + 1}/${providerStats.totalEndpoints}`,
          currentBlockNumber: currentBlockNumber,
          availableEndpoints: providerStats.totalEndpoints
        },
        eventProcessing: {
          lastProcessedBlock: lastProcessedBlock,
          blocksRemaining: currentBlockNumber ? currentBlockNumber - lastProcessedBlock : 'unknown'
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