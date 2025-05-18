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
    // Query 1: Get owned pixels count
    const pixelCountQuery = `
      SELECT COUNT(*) AS count
      FROM pixel_blocks
      WHERE current_owner = $1
    `;
    const pixelCountResult = await pool.query(pixelCountQuery, [address]);
    const owned_pixels = parseInt(pixelCountResult.rows[0].count, 10);

    // Query 2: Get user details
    const userQuery = `
      SELECT id, address, ens_name, first_connected, last_connected
      FROM users
      WHERE address = $1
    `;
    const userResult = await pool.query(userQuery, [address]);

    if (userResult.rowCount > 0) {
      // User found, combine with owned_pixels
      const userData = { ...userResult.rows[0], owned_pixels };
      res.status(200).json(userData);
    } else {
      // User not found in users table
      if (owned_pixels > 0) {
        // User has pixels but no record in users table
        // Return a minimal user object with address and owned_pixels
        res.status(200).json({
          id: null, // No ID as user is not in the users table
          address: address,
          ens_name: null,
          first_connected: null,
          last_connected: null,
          owned_pixels: owned_pixels,
        });
      } else {
        // User not found and owns no pixels
        return res.status(404).json({ error: 'User not found and owns no pixels' });
      }
    }
  } catch (error) {
    logger.error('Error fetching user data:', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Database error while fetching user data' });
  }
});

export default router;
