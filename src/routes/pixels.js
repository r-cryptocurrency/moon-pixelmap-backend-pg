import { Router } from 'express'
import { pool } from '../utils/db.js'
import { createChildLogger } from '../utils/logger.js'; // Import shared logger
import { validateCoords } from '../utils/validation.js'; // Import centralized validation

const logger = createChildLogger('pixelsRoute'); // Use shared logger
const router = Router()

// GET /api/pixels - Retrieve all pixel block data (owner, URI)
router.get('/', async (req, res) => {
  try {
    // Fetch all pixel blocks that have an owner (i.e., are minted)
    const result = await pool.query(
      'SELECT x, y, uri, current_owner, timestamp FROM pixel_blocks WHERE current_owner IS NOT NULL ORDER BY y, x'
    );
    res.json(result.rows);
  } catch (err) {
    logger.error('Error fetching all pixel blocks:', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Failed to fetch pixel blocks' });
  }
});

// GET /api/pixels/:x/:y - Retrieve data for a specific pixel block
router.get('/:x/:y', validateCoords, async (req, res) => {
  const { x, y } = req.validatedCoords;
  try {
    const result = await pool.query(
      'SELECT x, y, uri, current_owner, timestamp FROM pixel_blocks WHERE x = $1 AND y = $2',
      [x, y]
    );
    if (result.rows.length > 0) {
      res.json(result.rows[0]);
    } else {
      res.status(404).json({ error: 'Pixel block not found or not minted' });
    }
  } catch (err) {
    logger.error('Error fetching specific pixel block:', { error: err.message, stack: err.stack, x, y });
    res.status(500).json({ error: 'Failed to fetch pixel block' });
  }
});

export default router;