import { createCanvas, loadImage } from 'canvas'
import { LRUCache } from 'lru-cache'

const TILE_SIZE = 10
const GRID_TILES = 100
const TOTAL_SIZE = TILE_SIZE * GRID_TILES

// Separate caches for decoded images and final composition
const tileCache = new LRUCache({
  max: 500,
  ttl: 1000 * 60 * 5
})

const imageCache = new LRUCache({
  max: 1,
  ttl: 1000 * 60 // 1 minute cache for full image
})

export const decodeTileUri = (uri) => {
  if (!uri) {
    console.warn('Received undefined URI')
    return null
  }

  try {
    // Remove base64 prefix if present
    const base64Data = uri.replace(/^data:image\/\w+;base64,/, '')
    return Buffer.from(base64Data, 'base64')
  } catch (err) {
    console.error('URI decode error:', err)
    return null
  }
}

export const generatePixelMap = async (tiles) => {
  if (!Array.isArray(tiles)) {
    console.error('Invalid tiles input:', tiles)
    return []
  }

  const processedTiles = []
  
  for (const tile of tiles) {
    try {
      if (!tile?.uri) {
        console.warn('Skipping tile with missing URI')
        continue
      }
      const decodedData = decodeTileUri(tile.uri)
      if (!decodedData) continue
      
      processedTiles.push({
        ...tile,
        imageData: decodedData
      })
    } catch (err) {
      console.error('Tile processing error:', err)
    }
  }

  return processedTiles
}

export { TILE_SIZE, GRID_TILES }