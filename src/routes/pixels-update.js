import express from 'express';
import { pool } from '../utils/db.js';
import logger from '../utils/logger.js';
import { validateCoords, validateAddressInBody, validateImageInBody } from '../utils/validation.js';

const router = express.Router();

/**
 * Batch update multiple pixels that the user owns
 * This endpoint validates ownership of all pixels before allowing updates
 */
router.post('/', validateAddressInBody, async (req, res) => {
  // Get validated fields from middleware and pixels from body
  const address = req.validatedBody?.address || req.body.address;
  const { pixels } = req.body;

  // Validate pixels array
  if (!pixels || !Array.isArray(pixels) || pixels.length === 0) {
    return res.status(400).json({ error: 'Invalid or missing pixels array' });
  }

  // Validate each pixel coordinate and image
  for (const pixel of pixels) {
    if (!pixel.x || !pixel.y || !Number.isInteger(pixel.x) || !Number.isInteger(pixel.y)) {
      return res.status(400).json({ error: 'Invalid pixel coordinates in array' });
    }
    if (pixel.x < 0 || pixel.x > 99 || pixel.y < 0 || pixel.y > 99) {
      return res.status(400).json({ error: 'Pixel coordinates must be between 0-99' });
    }
    if (!pixel.image || typeof pixel.image !== 'string') {
      return res.status(400).json({ error: 'Each pixel must have an image' });
    }
  }

  try {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // 1. Check ownership of all pixels
      const pixelCoords = pixels.map(p => `(${p.x}, ${p.y})`).join(', ');
      const checkQuery = `
        SELECT x, y, current_owner 
        FROM pixel_blocks 
        WHERE (x, y) IN (${pixels.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ')})
      `;
      const checkParams = pixels.flatMap(p => [p.x, p.y]);
      const checkResult = await client.query(checkQuery, checkParams);
      
      // Verify we found all pixels
      if (checkResult.rowCount !== pixels.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'One or more pixels not found' });
      }
      
      // Verify user owns all pixels
      const unownedPixels = checkResult.rows.filter(
        row => row.current_owner?.toLowerCase() !== address.toLowerCase()
      );
      
      if (unownedPixels.length > 0) {
        await client.query('ROLLBACK');
        return res.status(403).json({ 
          error: `You do not own ${unownedPixels.length} of the selected pixels`,
          unownedPixels: unownedPixels.map(p => ({ x: p.x, y: p.y }))
        });
      }
      
      // 2. Update each pixel with its individual image
      const timestamp = new Date();
      const updatePromises = pixels.map(pixel => {
        const updateQuery = `
          UPDATE pixel_blocks 
          SET uri = $1, updated_at = $2 
          WHERE x = $3 AND y = $4
          RETURNING *
        `;
        return client.query(updateQuery, [pixel.image, timestamp, pixel.x, pixel.y]);
      });
      
      const updateResults = await Promise.all(updatePromises);
      const updatedPixels = updateResults.flatMap(r => r.rows);
      
      // 3. Insert history records for all pixels
      const historyValues = pixels.map((p, i) => 
        `($${i * 5 + 1}, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}, $${i * 5 + 5})`
      ).join(', ');
      const historyQuery = `
        INSERT INTO pixel_block_uri_history (x, y, uri, owner, timestamp)
        VALUES ${historyValues}
      `;
      const historyParams = pixels.flatMap(p => [p.x, p.y, p.image, address, timestamp]);
      await client.query(historyQuery, historyParams);
      
      // 4. Commit the transaction
      await client.query('COMMIT');
      
      logger.info(`Batch updated ${pixels.length} pixels by ${address}`);
      
      // 5. Return success with updated pixels
      res.status(200).json({
        success: true,
        pixelsUpdated: pixels.length,
        timestamp: timestamp.toISOString(),
        pixels: updatedPixels
      });
      
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Error in batch pixel update:', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Database error while updating pixels' });
  }
});

/**
 * Update a pixel that the user owns
 * This endpoint validates pixel ownership before allowing updates
 */
router.post('/:x/:y', validateCoords, validateAddressInBody, validateImageInBody, async (req, res) => {
  const { x, y } = req.validatedCoords || req.params;
  const { address, image, metadata } = req.validatedBody || req.body;

  try {
    // Begin a database transaction
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // 1. Check if the pixel exists and who owns it
  const pixelQuery = 'SELECT * FROM pixel_blocks WHERE x = $1 AND y = $2';
  const pixelResult = await client.query(pixelQuery, [x, y]);
      
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
      
  const updateResult = await client.query(updateQuery, [image, timestamp, x, y]);
      
      // 4. Insert a history record
      const historyQuery = `
        INSERT INTO pixel_block_uri_history (x, y, uri, owner, timestamp)
        VALUES ($1, $2, $3, $4, $5)
      `;
  await client.query(historyQuery, [x, y, image, address, timestamp]);
      
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
