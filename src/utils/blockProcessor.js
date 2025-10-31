import dotenv from 'dotenv';
dotenv.config();
import { CONTRACT_CONFIG } from '../config.js';
import { ethers } from 'ethers';
import { pool } from './db.js';
import { processEventLog } from '../services/eventProcessor.js';
import { createChildLogger } from './logger.js'; // Import shared logger

const logger = createChildLogger('blockProcessor'); // Use shared logger

// Create an Alchemy provider
const provider = new ethers.providers.JsonRpcProvider(process.env.ALCHEMY_URL);

const contract = new ethers.Contract(CONTRACT_CONFIG.address[42170], CONTRACT_CONFIG.abi, provider);

async function getLastProcessedBlock() {
  let client;
  try {
    client = await pool.connect();
    const result = await client.query('SELECT MAX(block_number) AS last_block FROM events');
    const defaultStartBlock = parseInt(process.env.ARBITRUM_NOVA_GENESIS_BLOCK || '1954820', 10) - 1;
    const lastBlock = result.rows[0]?.last_block;
    if (lastBlock == null) {
      logger.info('No last processed block found in events table, using default start block.');
      return defaultStartBlock;
    }
    return lastBlock;
  } catch (err) {
    logger.error('Error getting last processed block', { error: err.message, stack: err.stack });
    return parseInt(process.env.ARBITRUM_NOVA_GENESIS_BLOCK || '1954820', 10) - 1;
  } finally {
    if (client) client.release();
  }
}

async function processEventsFromLastBlock() {
  let client;
  try {
    // logger.info('Starting to process events from last block...');
    const lastBlock = await getLastProcessedBlock();
    if (typeof lastBlock !== 'number' || isNaN(lastBlock)) {
      logger.error('Invalid lastBlock received, cannot proceed with event processing.', { lastBlockValue: lastBlock });
      return;
    }
    const currentBlock = await provider.getBlockNumber();
    // logger.info(`Last processed block: ${lastBlock}, Current block: ${currentBlock}`);
    
    // Alchemy free tier only allows 10 block range for eth_getLogs
    const batchSize = parseInt(process.env.EVENT_BATCH_SIZE || '10', 10);

    if (lastBlock >= currentBlock) {
      // logger.info('No new blocks to process.');
      return;
    }

    for (let startBlock = lastBlock + 1; startBlock <= currentBlock; startBlock += batchSize) {
      const endBlock = Math.min(startBlock + batchSize - 1, currentBlock);
      // logger.info(`Processing events from block ${startBlock} to ${endBlock}`);
      
      let events = [];
      try {
        events = await contract.queryFilter({}, startBlock, endBlock);
      } catch (queryError) {
        logger.error(`Failed to query events from block ${startBlock} to ${endBlock}`, { error: queryError.message, stack: queryError.stack });
        continue;
      }

      if (events.length === 0) {
        // logger.info(`No events found in block range ${startBlock}-${endBlock}.`);
        continue;
      }

      const blockTimestamps = {};
      const uniqueBlockNumbers = [...new Set(events.map(event => event.blockNumber))];
      
      for (const bn of uniqueBlockNumbers) {
        try {
          const block = await provider.getBlock(bn);
          blockTimestamps[bn] = block.timestamp;
        } catch (blockError) {
          logger.error(`Failed to fetch block ${bn}`, { error: blockError.message, stack: blockError.stack });
          blockTimestamps[bn] = Math.floor(Date.now() / 1000);
        }
      }

      client = await pool.connect();
      try {
        await client.query('BEGIN'); 

        for (const event of events) {
          const { blockNumber, transactionHash, event: eventName, args, logIndex } = event;
          const timestamp = blockTimestamps[blockNumber];

          if (timestamp === undefined) {
            logger.warn(`Missing timestamp for block ${blockNumber}, event ${eventName} (tx: ${transactionHash}) will use current time as fallback.`);
          }
          if (typeof logIndex === 'undefined') {
            logger.error('logIndex is undefined for event', { transactionHash, eventName, blockNumber });
            throw new Error(`logIndex is undefined for event in tx ${transactionHash} at block ${blockNumber}`);
          }

          // Safely serialize event arguments to avoid deferred ABI decoding errors
          let argsString;
          try {
            argsString = JSON.stringify(Array.isArray(args) ? args.map(a => a.toString()) : {});
          } catch (e) {
            // Ensure the fallback is valid JSON by stringifying it.
            argsString = JSON.stringify('[Unable to serialize args]');
          }

          // logger.debug(`Event: ${eventName}, Block: ${blockNumber}, TxHash: ${transactionHash}, LogIndex: ${logIndex}, Args: ${argsString}, Timestamp: ${timestamp}`);

          const insertEventQuery = `
            INSERT INTO events (block_number, transaction_hash, event_type, args, timestamp, log_index)
            VALUES ($1, $2, $3, $4, to_timestamp($5), $6)
            ON CONFLICT (transaction_hash, log_index) DO NOTHING; 
          `;
          await client.query(insertEventQuery, [blockNumber, transactionHash, eventName, argsString, timestamp, logIndex]);

          await processEventLog(event, timestamp, client, contract, logger, ethers);
        }
        await client.query('COMMIT');
        // logger.info(`Successfully processed and committed events from block ${startBlock} to ${endBlock}`);
      } catch (batchError) {
        if (client) {
          await client.query('ROLLBACK');
        }
        // Safely summarize the first event for error context without triggering ABI decoding
        const firstEvent = events.length > 0 ? events[0] : null;
        const eventMeta = firstEvent
          ? { transactionHash: firstEvent.transactionHash, eventName: firstEvent.event, blockNumber: firstEvent.blockNumber, logIndex: firstEvent.logIndex }
          : 'N/A';
        logger.error(
          `Error processing batch ${startBlock}-${endBlock}. Transaction rolled back.`,
          { error: batchError.message, stack: batchError.stack, eventBeingProcessed: eventMeta }
        );
      } finally {
        if (client) {
          client.release();
          client = null;
        }
      }
    }
  } catch (err) {
    logger.error('Major error in processEventsFromLastBlock loop.', { error: err.message, stack: err.stack });
  } finally {
    if (client) {
      client.release();
    }
  }
}

async function processTransactionsFromLastBlock() {
  let client;
  try {
    // logger.debug('Starting to process transactions from last block...');
    const lastBlock = await getLastProcessedBlock();
    if (typeof lastBlock !== 'number' || isNaN(lastBlock)) {
      logger.error('Invalid lastBlock received, cannot proceed with transaction processing.', { lastBlockValue: lastBlock });
      return;
    }
    const currentBlock = await provider.getBlockNumber();
    // logger.debug(`Transaction processing: Last block (from events): ${lastBlock}, Current block: ${currentBlock}`);

    for (let blockNumber = lastBlock + 1; blockNumber <= currentBlock; blockNumber++) {
      const block = await provider.getBlockWithTransactions(blockNumber);
      if (!block) {
        logger.warn(`Block ${blockNumber} not found or error fetching it with transactions.`);
        continue;
      }

      client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const tx of block.transactions) {
          if (tx.to && tx.to.toLowerCase() === CONTRACT_CONFIG.address[42170].toLowerCase()) {
            // logger.debug(`Relevant Transaction: ${tx.hash}, Block: ${blockNumber}, From: ${tx.from}, To: ${tx.to}, Value: ${ethers.utils.formatEther(tx.value)} ETH`);

            const insertTransactionQuery = `
              INSERT INTO transactions (block_number, transaction_hash, from_address, to_address, value, timestamp)
              VALUES ($1, $2, $3, $4, $5, to_timestamp($6))
              ON CONFLICT (transaction_hash) DO NOTHING;
            `;
            try {
              await client.query(insertTransactionQuery, [blockNumber, tx.hash, tx.from, tx.to, tx.value.toString(), block.timestamp]);
              // logger.debug(`Inserted transaction: ${tx.hash}`);
            } catch (err) {
              logger.error(`Error inserting transaction: ${tx.hash}`, { error: err.message, stack: err.stack });
              throw err;
            }
          }
        }
        await client.query('COMMIT');
        // logger.debug(`Committed transactions from block ${blockNumber}`);
      } catch (blockTxError) {
        if (client) await client.query('ROLLBACK');
        logger.error(`Error processing transactions for block ${blockNumber}. Rolled back.`, { error: blockTxError.message, stack: blockTxError.stack });
      } finally {
        if (client) {
          client.release();
          client = null;
        }
      }
    }
  } catch (err) {
    logger.error('Error processing transactions loop', { error: err.message, stack: err.stack });
  } finally {
    if (client) client.release();
  }
}

export { getLastProcessedBlock, processEventsFromLastBlock, processTransactionsFromLastBlock };