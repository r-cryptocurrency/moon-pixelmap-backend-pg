import express from 'express';
import { pool } from '../utils/db.js';
import logger from '../utils/logger.js';

const router = express.Router();

/**
 * Update a pixel that the user owns
 * This endpoint validates pixel ownership before allowing updates
 */
router.post('/:x/:y', async (req, res) => {
  const { x, y } = req.params;
  const { address, image, metadata } = req.body;
  
  // Basic validation
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return res.status(400).json({ error: 'Valid Ethereum address is required' });
  }
  
  if (!x || !y || isNaN(parseInt(x)) || isNaN(parseInt(y))) {
    return res.status(400).json({ error: 'Valid coordinates are required' });
  }
  
  // Validate image data (basic validation here, enhance as needed)
  if (!image) {
    return res.status(400).json({ error: 'Image data is required' });
  }
  
  try {
    // Begin a database transaction
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // 1. Check if the pixel exists and who owns it
      const pixelQuery = 'SELECT * FROM pixel_blocks WHERE x = $1 AND y = $2';
      const pixelResult = await client.query(pixelQuery, [parseInt(x), parseInt(y)]);
      
      if (pixelResult.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Pixel not found' });
      }
      
      const pixel = pixelResult.rows[0];
      
      // 2. Check if this address owns the pixel
      if (pixel.current_owner?.toLowerCase() !== address.toLowerCase()) {
        await client.query('ROLLBACK');
        return res.status(403).json({ 
          error: 'You do not own this pixel',
          actualOwner: pixel.current_owner || null
        });
      }
      
      // 3. Update the pixel's URI and timestamp
      const timestamp = new Date();
      const updateQuery = `
        UPDATE pixel_blocks 
        SET uri = $1, updated_at = $2 
        WHERE x = $3 AND y = $4
        RETURNING *
      `;
      
      const updateResult = await client.query(updateQuery, [image, timestamp, parseInt(x), parseInt(y)]);
      
      // 4. Insert a history record
      const historyQuery = `
        INSERT INTO pixel_block_uri_history (x, y, uri, owner, timestamp)
        VALUES ($1, $2, $3, $4, $5)
      `;
      await client.query(historyQuery, [parseInt(x), parseInt(y), image, address, timestamp]);
      
      // 5. Commit the transaction
      await client.query('COMMIT');
      
      logger.info(`Pixel at (${x}, ${y}) updated by ${address}`);
      
      // 6. Return the updated pixel data
      res.status(200).json({
        x: parseInt(x),
        y: parseInt(y),
        uri: image,
        owner: address,
        timestamp: timestamp.toISOString(),
        metadata: metadata || null
      });
      
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Error updating pixel:', { error: error.message, stack: error.stack, x, y });
    res.status(500).json({ error: 'Database error while updating pixel' });
  }
});

export default router;
