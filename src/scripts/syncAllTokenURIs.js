#!/usr/bin/env node
/**
 * Sync all token URIs from the blockchain to the database.
 * This fetches the current tokenURI for all 10,000 pixels and updates the DB.
 * Run this once to get current state, then let the event processor handle new updates.
 */

import dotenv from 'dotenv';
dotenv.config();

import { ethers } from 'ethers';
import { pool } from '../utils/db.js';
import { CONTRACT_CONFIG } from '../config.js';
import { getProvider, getBlockNumber } from '../utils/rpcProvider.js';

const GRID_WIDTH = 100;
const GRID_HEIGHT = 100;
const TOTAL_PIXELS = GRID_WIDTH * GRID_HEIGHT;
const BATCH_SIZE = 50; // How many tokens to fetch at once (be gentle on RPC)
const DELAY_BETWEEN_BATCHES = 500; // ms delay between batches to avoid rate limits

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function syncAllTokenURIs() {
  console.log('Starting full token URI sync...');
  
  const provider = getProvider();
  const contract = new ethers.Contract(CONTRACT_CONFIG.address[42170], CONTRACT_CONFIG.abi, provider);
  
  // Get current block to mark as our sync point
  const currentBlock = await getBlockNumber();
  console.log(`Current block: ${currentBlock}`);
  
  let client;
  let successCount = 0;
  let errorCount = 0;
  let unchangedCount = 0;
  
  try {
    client = await pool.connect();
    
    // Process in batches
    for (let batchStart = 0; batchStart < TOTAL_PIXELS; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, TOTAL_PIXELS);
      const batchPromises = [];
      
      console.log(`Processing tokens ${batchStart} to ${batchEnd - 1}...`);
      
      for (let tokenId = batchStart; tokenId < batchEnd; tokenId++) {
        const x = Math.floor(tokenId / GRID_WIDTH);
        const y = tokenId % GRID_WIDTH;
        
        batchPromises.push(
          (async () => {
            try {
              // Fetch tokenURI from contract
              const uri = await contract.tokenURI(tokenId);
              
              // Update database
              const result = await client.query(`
                UPDATE pixel_blocks 
                SET uri = $1, updated_at = NOW()
                WHERE x = $2 AND y = $3 AND (uri IS DISTINCT FROM $1)
                RETURNING x, y
              `, [uri, x, y]);
              
              if (result.rowCount > 0) {
                successCount++;
                if (successCount % 100 === 0) {
                  console.log(`  Updated ${successCount} pixels so far...`);
                }
              } else {
                unchangedCount++;
              }
              
              return { success: true, tokenId, x, y };
            } catch (err) {
              // Token might not be minted yet
              if (err.message.includes('nonexistent token') || err.message.includes('invalid token')) {
                return { success: true, tokenId, x, y, notMinted: true };
              }
              console.error(`Error fetching token ${tokenId} (${x},${y}):`, err.message);
              errorCount++;
              return { success: false, tokenId, x, y, error: err.message };
            }
          })()
        );
      }
      
      // Wait for batch to complete
      await Promise.all(batchPromises);
      
      // Delay between batches to avoid rate limits
      if (batchEnd < TOTAL_PIXELS) {
        await sleep(DELAY_BETWEEN_BATCHES);
      }
    }
    
    // Insert a marker event to update the last processed block
    await client.query(`
      INSERT INTO events (block_number, event_name, transaction_hash, args, timestamp)
      VALUES ($1, 'sync_marker', 'manual_sync_' || $1, '{}', NOW())
      ON CONFLICT DO NOTHING
    `, [currentBlock]);
    
    console.log('\n=== Sync Complete ===');
    console.log(`Updated: ${successCount}`);
    console.log(`Unchanged: ${unchangedCount}`);
    console.log(`Errors: ${errorCount}`);
    console.log(`Last block set to: ${currentBlock}`);
    console.log('\nYou can now restart the backend to process new events from this point.');
    
  } catch (err) {
    console.error('Fatal error during sync:', err);
    throw err;
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

// Run the sync
syncAllTokenURIs()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Sync failed:', err);
    process.exit(1);
  });
