import express from 'express';
import { cachedImage, generatePixelMapImage } from '../scripts/imageGenerator.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    if (cachedImage) {
      res.set('Content-Type', 'image/png');
      res.set('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
      res.send(cachedImage);
    } else {
      const imageBuffer = await generatePixelMapImage();
      res.set('Content-Type', 'image/png');
      res.set('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
      res.send(imageBuffer);
    }
  } catch (err) {
    console.error('Error generating pixel map image:', err);
    res.status(500).send('Error generating pixel map image');
  }
});

export default router;