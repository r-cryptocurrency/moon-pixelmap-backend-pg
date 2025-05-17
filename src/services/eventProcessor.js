import { ethers } from 'ethers';
import { createChildLogger } from '../utils/logger.js'; // Import shared logger

const logger = createChildLogger('eventProcessor'); // Use shared logger
const GRID_WIDTH = 100; // Same as in the smart contract blockId calculation

// Helper function to convert tokenId to X, Y coordinates
function convertTokenIdToXY(tokenId) {
  const x = Math.floor(tokenId / GRID_WIDTH);
  const y = tokenId % GRID_WIDTH;
  return { x, y };
}

// Helper function to calculate tokenId from X, Y coordinates
function calculateTokenId(x, y) {
  return x * GRID_WIDTH + y;
}

async function handleBuyEvent(dbClient, contract, parentLogger, ethersInstance, buyer, x, y, timestamp, transactionHash, blockNumber) {
  const logger = parentLogger.child({ function: 'handleBuyEvent' });
  logger.info(`Handling Buy event: x=${x}, y=${y}, owner=${buyer}, txHash=${transactionHash}`);
  let tokenUri = '';
  try {
    const tokenId = calculateTokenId(x, y);
    tokenUri = await contract.tokenURI(tokenId);
    // logger.info(`Fetched tokenURI for tokenId ${tokenId} (x:${x},y:${y}): ${tokenUri}`);
  } catch (uriError) {
    logger.error(`Error fetching tokenURI for x=${x}, y=${y}: ${uriError.message}`, { stack: uriError.stack, transactionHash, blockNumber });
    // Fallback to empty string if URI fetch fails
  }

  const insertPixelBlockQuery = `
    INSERT INTO pixel_blocks (x, y, current_owner, uri, timestamp, created_at, updated_at)
    VALUES ($1, $2, $3, $4, to_timestamp($5), to_timestamp($5), to_timestamp($5))
    ON CONFLICT (x, y) DO UPDATE SET
      current_owner = EXCLUDED.current_owner,
      uri = EXCLUDED.uri,
      timestamp = EXCLUDED.timestamp,
      updated_at = to_timestamp($5);
  `;
  try {
    await dbClient.query(insertPixelBlockQuery, [x, y, buyer, tokenUri, timestamp]);
    // logger.debug(`Upserted pixel block: x=${x}, y=${y}, owner=${buyer}, uri=${tokenUri}`);
  } catch (err) {
    logger.error(`Error upserting pixel block: x=${x}, y=${y}: ${err.message}`, { stack: err.stack, transactionHash, blockNumber });
    throw err; // Rethrow to ensure transaction rollback
  }

  const insertPixelBlockOwnerQuery = `
    INSERT INTO pixel_block_owners (x, y, owner, timestamp, transaction_hash, block_number)
    VALUES ($1, $2, $3, to_timestamp($4), $5, $6);
  `;
  try {
    await dbClient.query(insertPixelBlockOwnerQuery, [x, y, buyer, timestamp, transactionHash, blockNumber]);
    // logger.debug(`Inserted pixel block owner history: x=${x}, y=${y}, Owner: ${buyer}`);
  } catch (err) {
    logger.error(`Error inserting pixel block owner history: x=${x}, y=${y}, Owner: ${buyer}: ${err.message}`, { stack: err.stack, transactionHash, blockNumber });
    throw err; // Rethrow to ensure transaction rollback
  }
}

async function handleTransferEvent(dbClient, contract, parentLogger, ethersInstance, from, to, tokenIdBigNum, timestamp, transactionHash, blockNumber) {
  const logger = parentLogger.child({ function: 'handleTransferEvent' });
  const tokenId = ethersInstance.BigNumber.from(tokenIdBigNum).toNumber();
  const { x, y } = convertTokenIdToXY(tokenId);
  // logger.info(`Handling Transfer event: tokenId=${tokenId} (x=${x}, y=${y}), from=${from}, to=${to}, txHash=${transactionHash}`);

  if (from.toLowerCase() === ethersInstance.constants.AddressZero.toLowerCase()) { // MINT case
    logger.info(`Mint detected for tokenId ${tokenId} (x:${x}, y:${y}). Ensuring pixel block exists.`);
    let tokenUri = '';
    try {
      // It's possible tokenURI is set in the same transaction but after the Transfer event.
      // The Buy event handler might update it later if this call gets a stale/empty URI.
      tokenUri = await contract.tokenURI(tokenId);
      // logger.info(`Fetched tokenURI for minted token ${tokenId} (x:${x},y:${y}): ${tokenUri}`);
    } catch (uriError) {
      logger.error(`Error fetching tokenURI for minted token ${tokenId} (x:${x}, y:${y}): ${uriError.message}`, { stack: uriError.stack, transactionHash, blockNumber });
      // Fallback to empty string if URI fetch fails. The Buy event might populate it later.
    }

    const insertPixelBlockQuery = `
      INSERT INTO pixel_blocks (x, y, current_owner, uri, timestamp, created_at, updated_at)
      VALUES ($1, $2, $3, $4, to_timestamp($5), to_timestamp($5), to_timestamp($5))
      ON CONFLICT (x, y) DO UPDATE SET
        current_owner = EXCLUDED.current_owner,
        uri = CASE WHEN EXCLUDED.uri = '' THEN pixel_blocks.uri ELSE EXCLUDED.uri END, -- Prefer existing URI if new one is empty
        timestamp = EXCLUDED.timestamp,
        updated_at = to_timestamp($5);
    `;
    try {
      await dbClient.query(insertPixelBlockQuery, [x, y, to, tokenUri, timestamp]);
      logger.debug(`Upserted pixel block for mint: x=${x}, y=${y}, owner=${to}, uri=${tokenUri}`);
    } catch (err) {
      logger.error(`Error upserting pixel block for mint: x=${x}, y=${y}: ${err.message}`, { stack: err.stack, transactionHash, blockNumber });
      throw err; // Rethrow to ensure transaction rollback
    }
  } else { // REGULAR TRANSFER case
    const updatePixelBlockOwnerQuery = `
      UPDATE pixel_blocks
      SET current_owner = $1, timestamp = to_timestamp($4), updated_at = to_timestamp($4)
      WHERE x = $2 AND y = $3;
    `;
    try {
      const result = await dbClient.query(updatePixelBlockOwnerQuery, [to, x, y, timestamp]);
      if (result.rowCount > 0) {
        logger.debug(`Updated pixel block owner for transfer: x=${x}, y=${y}, New Owner: ${to}`);
      } else {
        logger.warn(`No pixel_block found to update for regular transfer: x=${x}, y=${y}. Owner: ${to}. This may lead to FK violation if block was never minted/processed.`, { transactionHash, blockNumber });
      }
    } catch (err) {
      logger.error(`Error updating pixel block owner for transfer: x=${x}, y=${y}, New Owner: ${to}: ${err.message}`, { stack: err.stack, transactionHash, blockNumber });
      throw err; // Rethrow to ensure transaction rollback
    }
  }

  // This insert happens for both mints and regular transfers.
  const insertPixelBlockOwnerQuery = `
    INSERT INTO pixel_block_owners (x, y, owner, timestamp, transaction_hash, block_Number)
    VALUES ($1, $2, $3, to_timestamp($4), $5, $6);
  `;
  try {
    await dbClient.query(insertPixelBlockOwnerQuery, [x, y, to, timestamp, transactionHash, blockNumber]);
    // logger.debug(`Inserted pixel block owner history: x=${x}, y=${y}, Owner: ${to}, Type: ${from.toLowerCase() === ethersInstance.constants.AddressZero.toLowerCase() ? 'mint' : 'transfer'}`);
  } catch (err) {
    logger.error(`Error inserting pixel block owner history: x=${x}, y=${y}, Owner: ${to}: ${err.message}`, { stack: err.stack, transactionHash, blockNumber });
    throw err; // Rethrow to ensure transaction rollback
  }
}

async function handleUpdateEvent(dbClient, parentLogger, ethersInstance, updater, x, y, uri, timestamp, transactionHash, blockNumber) {
  const logger = parentLogger.child({ function: 'handleUpdateEvent' });
  // logger.info(`Handling Update event: x=${x}, y=${y}, uri=${uri}, updater=${updater}, txHash=${transactionHash}`);
  
  const updatePixelBlockUriQuery = `
    UPDATE pixel_blocks
    SET uri = $1, timestamp = to_timestamp($4), updated_at = to_timestamp($4)
    WHERE x = $2 AND y = $3 AND current_owner = $5; 
  `;
  try {
    const result = await dbClient.query(updatePixelBlockUriQuery, [uri, x, y, timestamp, updater]);
    if (result.rowCount > 0) {
        // logger.debug(`Updated pixel block URI: x=${x}, y=${y}, New URI: ${uri}`);
    } else {
        logger.warn(`No pixel_block found to update URI for x=${x}, y=${y} by owner ${updater}, or owner mismatch. Contract should prevent unauthorized updates.`, { transactionHash, blockNumber });
    }
  } catch (err) {
    logger.error(`Error updating pixel block URI: x=${x}, y=${y}, New URI: ${uri}: ${err.message}`, { stack: err.stack, transactionHash, blockNumber });
    throw err; // Rethrow to ensure transaction rollback
  }

  const insertPixelBlockUriHistoryQuery = `
    INSERT INTO pixel_block_uri_history (x, y, uri, owner, timestamp, transaction_hash, block_number)
    VALUES ($1, $2, $3, $4, to_timestamp($5), $6, $7);
  `;
  try {
    await dbClient.query(insertPixelBlockUriHistoryQuery, [x, y, uri, updater, timestamp, transactionHash, blockNumber]);
    // logger.debug(`Inserted pixel block URI history: x=${x}, y=${y}, URI: ${uri}, Owner: ${updater}`);
  } catch (err) {
    logger.error(`Error inserting pixel block URI history: x=${x}, y=${y}, URI: ${uri}, Owner: ${updater}: ${err.message}`, { stack: err.stack, transactionHash, blockNumber });
    throw err; // Rethrow to ensure transaction rollback
  }
}

async function handleNamedEvent(dbClient, parentLogger, ethersInstance, user, name, timestamp, transactionHash, blockNumber) {
  const logger = parentLogger.child({ function: 'handleNamedEvent' });
  // logger.info(`Handling Named event: user=${user}, name='${name}', txHash=${transactionHash}, blockNumber=${blockNumber}, timestamp=${timestamp}`);
  
  const upsertUserQuery = `
    INSERT INTO users (address, user_name, updated_at, created_at)
    VALUES ($1, $2, to_timestamp($3), to_timestamp($3))
    ON CONFLICT (address) DO UPDATE SET
      user_name = EXCLUDED.user_name,
      updated_at = EXCLUDED.updated_at;
  `;

  const insertUserNameHistoryQuery = `
    INSERT INTO user_name_history (user_address, user_name, timestamp, transaction_hash, block_number)
    VALUES ($1, $2, to_timestamp($3), $4, $5);
  `;

  try {
    await dbClient.query(upsertUserQuery, [user, name, timestamp]);
    // logger.debug(`Upserted user: address=${user}, name='${name}'`);

    await dbClient.query(insertUserNameHistoryQuery, [user, name, timestamp, transactionHash, blockNumber]);
    // logger.debug(`Inserted user name history: address=${user}, name='${name}'`);

  } catch (err) {
    logger.error(`Error processing Named event for user (address=${user}, name='${name}'): ${err.message}`, { stack: err.stack, transactionHash, blockNumber });
    throw err; // Rethrow to ensure transaction rollback
  }
}

async function handleOwnershipTransferredEvent(dbClient, parentLogger, ethersInstance, previousOwner, newOwner, timestamp, transactionHash, blockNumber) {
  const logger = parentLogger.child({ function: 'handleOwnershipTransferredEvent' });
  // logger.info(`Handling OwnershipTransferred event (contract ownership): previousOwner=${previousOwner}, newOwner=${newOwner}, txHash=${transactionHash}`);
  // This event relates to the contract's ownable pattern, not pixel ownership.
  // For now, logging is sufficient. If needed, this could write to a dedicated table.
}

export async function processEventLog(eventLogFromEthers, eventTimestamp, dbClient, contract, parentLogger, ethersInstance) {
  const logger = parentLogger.child({ function: 'processEventLog' }); // Create child logger for this function
  const { blockNumber, transactionHash, event: eventName, args, logIndex } = eventLogFromEthers; // Added logIndex for completeness if needed here

  logger.debug(`Dispatching event: ${eventName}, Block: ${blockNumber}, TxHash: ${transactionHash}, LogIndex: ${logIndex}, Args: ${JSON.stringify(args)}, Timestamp: ${eventTimestamp}`);

  try {
    if (eventName === 'Buy') {
      const { buyer, x, y } = args;
      const xCoord = ethersInstance.BigNumber.from(x).toNumber();
      const yCoord = ethersInstance.BigNumber.from(y).toNumber();
      await handleBuyEvent(dbClient, contract, logger, ethersInstance, buyer, xCoord, yCoord, eventTimestamp, transactionHash, blockNumber);
    } else if (eventName === 'BatchBuy') {
      const { buyer, x: xArray, y: yArray } = args;
      for (let i = 0; i < xArray.length; i++) {
        const xCoord = ethersInstance.BigNumber.from(xArray[i]).toNumber();
        const yCoord = ethersInstance.BigNumber.from(yArray[i]).toNumber();
        await handleBuyEvent(dbClient, contract, logger, ethersInstance, buyer, xCoord, yCoord, eventTimestamp, transactionHash, blockNumber);
      }
    } else if (eventName === 'Transfer') {
      const { from, to, tokenId } = args;
      await handleTransferEvent(dbClient, contract, logger, ethersInstance, from, to, tokenId, eventTimestamp, transactionHash, blockNumber);
    } else if (eventName === 'Update') {
      const updater = args[0]; 
      const xCoord = ethersInstance.BigNumber.from(args[1]).toNumber(); 
      const yCoord = ethersInstance.BigNumber.from(args[2]).toNumber(); 
      const uri = args[3]; 
      await handleUpdateEvent(dbClient, logger, ethersInstance, updater, xCoord, yCoord, uri, eventTimestamp, transactionHash, blockNumber);
    } else if (eventName === 'OwnershipTransferred') {
      const { previousOwner, newOwner } = args;
      await handleOwnershipTransferredEvent(dbClient, logger, ethersInstance, previousOwner, newOwner, eventTimestamp, transactionHash, blockNumber);
    } else if (eventName === 'Named') { // Added handler for Named event
      const eventArgs = eventLogFromEthers.args;
      const user = eventArgs[0]; // First argument from ABI is 'user' (address)
      const nameArg = eventArgs[1]; // Second argument from ABI is 'name' (string, indexed)

      let nameToStore;

      if (typeof nameArg === 'string') {
        // This would typically be for non-indexed strings or very short indexed ones (uncommon)
        nameToStore = nameArg;
      } else if (nameArg && typeof nameArg === 'object' && typeof nameArg.hash === 'string') {
        // 'name' is an indexed string, and we received an object with its hash.
        nameToStore = nameArg.hash; // Storing the hash as the name is not ideal but all we have from event.
        logger.warn(`Storing Keccak-256 hash for indexed string 'name' for user ${user}. Original name: [Not directly available from event topics]. Hash: ${nameToStore}. Tx: ${transactionHash}`);
      } else {
        logger.warn(`Unexpected format or missing 'name' argument in Named event for user ${user}. Value: ${JSON.stringify(nameArg)}. Storing name as null. Tx: ${transactionHash}`);
        nameToStore = null; // Default to null if name cannot be determined
      }

      // Validate user address before proceeding
      if (!user || typeof user !== 'string' || !user.startsWith('0x') || user.length !== 42) {
        logger.error(`Invalid or undefined user address in Named event. Address received: '${user}'. Tx: ${transactionHash}. Skipping event.`);
        return; // Skip processing this event to prevent DB errors
      }

      await handleNamedEvent(dbClient, logger, ethersInstance, user, nameToStore, eventTimestamp, transactionHash, blockNumber);
    } else {
      logger.info(`Unhandled event type: ${eventName}`);
    }
  } catch (error) {
    logger.error(`Error during event processing for ${eventName} (tx: ${transactionHash}): ${error.message}`, { stack: error.stack, eventArgs: JSON.stringify(args), transactionHash, blockNumber });
    throw error; // Rethrow to ensure transaction in blockProcessor is rolled back for this batch
  }
}