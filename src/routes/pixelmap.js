import { Router } from 'express';
import { generatePixelMapImage, cachedImage, clearImageCache } from '../utils/imageGenerator.js';
import { createChildLogger } from '../utils/logger.js'; // Import shared logger

const logger = createChildLogger('pixelmapRoute'); // Use shared logger
const router = Router();

router.get('/', async (req, res) => {
  try {
    let imageBuffer = cachedImage;
    if (!imageBuffer) {
      logger.info('Cache miss, generating new pixel map image for /api/pixelmap');
      imageBuffer = await generatePixelMapImage();
    } else {
      logger.info('Cache hit for /api/pixelmap');
    }

    if (imageBuffer) {
      res.set('Content-Type', 'image/png');
      res.set('Cache-Control', 'public, max-age=3600');
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type');
      res.send(imageBuffer);
    } else {
      logger.error('Failed to generate or retrieve image buffer for /api/pixelmap');
      res.status(500).send('Error generating pixel map');
    }
  } catch (err) {
    logger.error('Error in GET /api/pixelmap:', { error: err.message, stack: err.stack });
    res.status(500).send('Error generating pixel map');
  }
});

router.post('/clear-cache', (req, res) => {
  clearImageCache();
  logger.info('/api/pixelmap/clear-cache called: Image cache cleared.');
  res.status(200).send('Image cache cleared');
});

export default router;