import { createCanvas, loadImage } from 'canvas';
import { pool } from './db.js';
import { createChildLogger } from './logger.js'; // Import shared logger

const logger = createChildLogger('imageGenerator'); // Use shared logger
let cachedImage = null;
const BLOCK_SIZE = 10;
const GRID_SIZE = 100;
const CACHE_TIMEOUT = 5000; // 5 seconds

async function generatePixelMapImage() {
  logger.info('Starting pixel map image generation...');
  try {
    // Start with all blocks as unminted (black)
    const canvas = createCanvas(GRID_SIZE * BLOCK_SIZE, GRID_SIZE * BLOCK_SIZE);
    const ctx = canvas.getContext('2d');
    
    // Fill entire canvas with black (unminted state)
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, GRID_SIZE * BLOCK_SIZE, GRID_SIZE * BLOCK_SIZE);

    // Get minted blocks
    const result = await pool.query(`
      SELECT x, y, uri, current_owner 
      FROM pixel_blocks
      WHERE current_owner IS NOT NULL
    `);
    
    logger.info('Processing minted blocks:', { count: result.rows.length });
    
    let noUri = 0;
    let withUri = 0;
    let urisSkippedDueToEmptyTrimmedUri = 0;
    let urisSkippedDueToInvalidJsonFormat = 0;
    let urisSkippedDueToMissingImageFieldInJson = 0;
    let urisSkippedDueToUnsupportedScheme = 0;
    let urisWhereLoadImageAttempted = 0;
    let urisSuccessfullyLoadedAndDrawn = 0;

    // Process minted blocks
    for (const block of result.rows) {
      const pixelX = block.x * BLOCK_SIZE;
      const pixelY = block.y * BLOCK_SIZE;

      if (!block.uri || block.uri.trim() === '') {
        // Minted but no URI - grey
        ctx.fillStyle = '#808080';
        ctx.fillRect(pixelX, pixelY, BLOCK_SIZE, BLOCK_SIZE);
        noUri++;
        urisSkippedDueToEmptyTrimmedUri++;
        logger.warn(`Pixel block (${block.x},${block.y}) had whitespace-only URI in DB: '${block.uri}'`);
        continue;
      }

      let imageUriToLoad = block.uri.trim();
      try {
        // Check if the URI is a JSON data URI
        if (imageUriToLoad.startsWith('data:application/json;base64,')) {
          const base64Data = imageUriToLoad.split(',')[1];
          let jsonDataString;
          try {
            jsonDataString = Buffer.from(base64Data, 'base64').toString('utf-8');
          } catch (bufferError) {
            logger.warn(`Failed to decode base64 for JSON URI of block (${block.x},${block.y}): ${bufferError.message}. URI: ${block.uri.substring(0,100)}`);
            urisSkippedDueToInvalidJsonFormat++;
            continue;
          }
          
          let parsedJson;
          try {
            parsedJson = JSON.parse(jsonDataString);
          } catch (jsonParseError) {
            logger.warn(`Failed to parse JSON for block (${block.x},${block.y}): ${jsonParseError.message}. Data: ${jsonDataString.substring(0,100)}. URI: ${block.uri.substring(0,100)}`);
            urisSkippedDueToInvalidJsonFormat++;
            continue;
          }

          if (parsedJson.image && typeof parsedJson.image === 'string' && parsedJson.image.trim() !== '') {
            imageUriToLoad = parsedJson.image.trim();
            logger.debug(`Extracted image URI ${imageUriToLoad.substring(0,100)}... from JSON for block (${block.x},${block.y})`);
          } else {
            logger.warn(`JSON URI for block (${block.x},${block.y}) lacks valid 'image' field or image URI is empty. URI: ${block.uri.substring(0,100)}`);
            urisSkippedDueToMissingImageFieldInJson++;
            continue; 
          }
        }

        // Validate that imageUriToLoad is a data URI or a recognized image format
        if (!imageUriToLoad.startsWith('data:image/') && !imageUriToLoad.startsWith('http://') && !imageUriToLoad.startsWith('https://')) {
          logger.warn(`Unsupported URI scheme or format for block (${block.x},${block.y}): ${imageUriToLoad.substring(0,100)}...`);
          urisSkippedDueToUnsupportedScheme++;
          continue;
        }

        urisWhereLoadImageAttempted++;
        const img = await loadImage(imageUriToLoad); // loadImage can handle data URIs and URLs
        ctx.drawImage(img, pixelX, pixelY, BLOCK_SIZE, BLOCK_SIZE);
        withUri++;
        urisSuccessfullyLoadedAndDrawn++;
      } catch (err) {
        logger.error(`Failed to load image from URI for block (${block.x},${block.y}): ${imageUriToLoad.substring(0,100)}...`, { error: err.message, stack: err.stack });
        ctx.fillStyle = '#FFCC00'; // Error color, e.g., orange
        ctx.fillRect(pixelX, pixelY, BLOCK_SIZE, BLOCK_SIZE);
      }
    }

    const actualFailuresAtLoadImageOrDraw = urisWhereLoadImageAttempted - urisSuccessfullyLoadedAndDrawn;

    logger.info('Generated map with pixels:', {
      total: GRID_SIZE * GRID_SIZE,
      minted: result.rows.length,
      noUri,
      withUri,
      urisSkippedDueToEmptyTrimmedUri,
      urisSkippedDueToInvalidJsonFormat,
      urisSkippedDueToMissingImageFieldInJson,
      urisSkippedDueToUnsupportedScheme,
      urisWhereLoadImageAttempted,
      urisSuccessfullyLoadedAndDrawn,
      actualFailuresAtLoadImageOrDraw
    });

    cachedImage = canvas.toBuffer();
    
    setTimeout(() => {
      cachedImage = null;
    }, CACHE_TIMEOUT);

    return cachedImage;
  } catch (err) {
    logger.error('Error generating pixel map:', { error: err.message, stack: err.stack });
    throw err;
  }
}

function clearImageCache() {
  cachedImage = null;
  logger.info('Image cache cleared');
}

const IMAGE_REFRESH_INTERVAL = 1000 * 60 * 5; // 5 minutes
setInterval(async () => {
  try {
    logger.info('Periodically refreshing pixel map image...');
    await generatePixelMapImage(); // This will update cachedImage
  } catch (err) {
    logger.error('Error during periodic image refresh:', { error: err.message, stack: err.stack });
  }
}, IMAGE_REFRESH_INTERVAL);

export { generatePixelMapImage, clearImageCache, cachedImage };