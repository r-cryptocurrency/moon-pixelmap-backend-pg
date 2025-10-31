// Validation middleware for routes
import { createChildLogger } from './logger.js';

const logger = createChildLogger('validation');

export function validateCoords(req, res, next) {
  const x = Number.isFinite ? parseInt(req.params.x, 10) : parseInt(req.params.x);
  const y = Number.isFinite ? parseInt(req.params.y, 10) : parseInt(req.params.y);
  const GRID_TILES = 100;

  if (Number.isNaN(x) || Number.isNaN(y) || x < 0 || x >= GRID_TILES || y < 0 || y >= GRID_TILES) {
    logger.warn('Invalid coordinates in request', { params: req.params });
    return res.status(400).json({ error: 'Invalid coordinates' });
  }

  req.validatedCoords = { x, y };
  next();
}

export function validateAddressInBody(req, res, next) {
  const { address } = req.body || {};
  if (!address || typeof address !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    logger.warn('Invalid or missing Ethereum address in request body', { body: req.body });
    return res.status(400).json({ error: 'Valid Ethereum address is required' });
  }
  req.validatedBody = { ...(req.validatedBody || {}), address };
  next();
}

export function validateImageInBody(req, res, next) {
  const { image } = req.body || {};
  if (!image || typeof image !== 'string' || image.trim() === '') {
    logger.warn('Missing or invalid image in request body', { body: req.body });
    return res.status(400).json({ error: 'Image data is required' });
  }
  // Optionally: limit size of image string to e.g. 200k characters
  if (image.length > 200_000) {
    logger.warn('Image data too large', { length: image.length });
    return res.status(400).json({ error: 'Image data too large' });
  }
  req.validatedBody = { ...(req.validatedBody || {}), image };
  next();
}

export function validateAddressInParams(req, res, next) {
  const { address } = req.params || {};
  if (!address || typeof address !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    logger.warn('Invalid Ethereum address in request params', { params: req.params });
    return res.status(400).json({ error: 'Invalid Ethereum address' });
  }
  req.validatedParams = { ...(req.validatedParams || {}), address };
  next();
}

export default {
  validateCoords,
  validateAddressInBody,
  validateAddressInParams,
  validateImageInBody,
};
