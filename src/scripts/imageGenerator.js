import { createCanvas, loadImage } from 'canvas';
import pkg from 'pg';
import { DB_CONFIG } from '../config.js';
import winston from 'winston';

const { Pool } = pkg;
const pool = new Pool(DB_CONFIG);

const PIXEL_SIZE = 10; // Size of each pixel block
const MAP_WIDTH = 100; // Width of the pixel map in blocks
const MAP_HEIGHT = 100; // Height of the pixel map in blocks

// Configure winston logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} ${level}: ${message}`)
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

// Cache object to store the generated image and the last update time
let cachedImage = null;
let lastUpdateTime = null;

async function generatePixelMapImage() {
  const canvas = createCanvas(MAP_WIDTH * PIXEL_SIZE, MAP_HEIGHT * PIXEL_SIZE);
  const ctx = canvas.getContext('2d');

  try {
    const client = await pool.connect();
    logger.info('Connected to the database');
    const result = await client.query('SELECT x, y, uri FROM pixel_blocks');
    client.release();
    logger.info('Fetched pixel blocks from the database');

    for (const row of result.rows) {
      const { x, y, uri } = row;
      try {
        if (!uri) {
          throw new Error('URI is null or undefined');
        }
        logger.debug(`Loading image for pixel (${x}, ${y}) with URI: ${uri}`);
        
        // Decode the JSON object from the base64-encoded URI
        const base64Data = uri.split(',')[1];
        const jsonString = Buffer.from(base64Data, 'base64').toString('utf-8');
        const jsonObject = JSON.parse(jsonString);

        // Validate the JSON object
        if (!jsonObject.image) {
          throw new Error('Malformed JSON: missing "image" field');
        }

        // Correct simple formatting errors (e.g., missing data:image/png;base64, prefix)
        let imageData = jsonObject.image;
        if (!imageData.startsWith('data:image/')) {
          imageData = `data:image/png;base64,${imageData}`;
        }

        // Load the image from the base64-encoded image data
        const image = await loadImage(imageData);
        ctx.drawImage(image, x * PIXEL_SIZE, y * PIXEL_SIZE, PIXEL_SIZE, PIXEL_SIZE);
        logger.debug(`Successfully loaded and drew image for pixel (${x}, ${y})`);
      } catch (err) {
        logger.debug(`Error loading image for pixel (${x}, ${y}): ${err.message}`);
        // Fill the pixel with a default color (e.g., grey) if the image cannot be loaded
        ctx.fillStyle = 'grey';
        ctx.fillRect(x * PIXEL_SIZE, y * PIXEL_SIZE, PIXEL_SIZE, PIXEL_SIZE);
        logger.debug(`Filled pixel (${x}, ${y}) with grey color`);
      }
    }
  } catch (err) {
    logger.error(`Error generating pixel map image: ${err.message}`);
  }

  return canvas.toBuffer();
}

// Function to check for updates and regenerate the image if needed
async function checkForUpdates() {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT MAX(updated_at) AS last_update FROM pixel_blocks');
    client.release();
    const lastUpdate = result.rows[0]?.last_update;

    if (!lastUpdateTime || new Date(lastUpdate) > new Date(lastUpdateTime)) {
      logger.info('Updates detected, regenerating pixel map image');
      cachedImage = await generatePixelMapImage();
      lastUpdateTime = new Date(lastUpdate);
    } else {
      logger.info('No updates detected, using cached pixel map image');
    }
  } catch (err) {
    logger.error('Error checking for updates:', err);
  }
}

// Schedule the checkForUpdates function to run every ten minutes
setInterval(checkForUpdates, 10 * 60 * 1000);

// Initial check for updates
checkForUpdates();

export { generatePixelMapImage, cachedImage };