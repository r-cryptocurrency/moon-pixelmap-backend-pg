import express from 'express';
import { pool } from '../utils/db.js';
import logger from '../utils/logger.js';

const router = express.Router();

// POST /api/users - Store user connection data
router.post('/', async (req, res) => {
  const { address, ensName, lastConnected } = req.body;
  
  // Validate input data
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return res.status(400).json({ error: 'Invalid Ethereum address' });
  }

  try {
    // Check if user already exists by address
    const checkUserQuery = 'SELECT * FROM users WHERE address = $1';
    const existingUser = await pool.query(checkUserQuery, [address]);
    
    if (existingUser.rowCount > 0) {
      // User exists, update last connected time
      const updateQuery = `
        UPDATE users 
        SET last_connected = $1, 
            ens_name = $2
        WHERE address = $3
        RETURNING *
      `;
      const result = await pool.query(updateQuery, [lastConnected, ensName, address]);
      logger.info(`Updated user data for address: ${address}`);
      res.status(200).json(result.rows[0]);
    } else {
      // User doesn't exist, create new record
      const insertQuery = `
        INSERT INTO users (address, ens_name, first_connected, last_connected)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `;
      const result = await pool.query(insertQuery, [address, ensName, lastConnected, lastConnected]);
      logger.info(`Created new user record for address: ${address}`);
      res.status(201).json(result.rows[0]);
    }
  } catch (error) {
    logger.error('Error handling user data:', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Database error while processing user data' });
  }
});

// GET /api/users/:address - Get user data
router.get('/:address', async (req, res) => {
  const { address } = req.params;
  
  // Validate address
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return res.status(400).json({ error: 'Invalid Ethereum address' });
  }
  
  try {
    // Query user data
    const query = `
      SELECT u.*, 
             (SELECT COUNT(*) FROM pixel_blocks WHERE current_owner = u.address) AS owned_pixels
      FROM users u
      WHERE u.address = $1
    `;
    const result = await pool.query(query, [address]);
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.status(200).json(result.rows[0]);
  } catch (error) {
    logger.error('Error fetching user data:', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Database error while fetching user data' });
  }
});

export default router;
