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
  const { blockNumber, transactionHash, event: eventName, logIndex, data, topics } = eventLogFromEthers; // Added data and topics for raw decoding
  
  // Helper function to safely access event args
  // ethers.js uses deferred decoding which can throw when accessing certain indices
  const safeGetArg = (args, index) => {
    try {
      return args[index];
    } catch (err) {
      logger.warn(`Failed to access args[${index}] - deferred ABI decoding error`, { 
        error: err.message, 
        transactionHash, 
        blockNumber 
      });
      return null;
    }
  };

  // Helper function to safely serialize args for logging
  const safeSerializeArgs = (args) => {
    try {
      if (!args) return 'null';
      const result = [];
      // Only try to access up to 10 args to avoid infinite loops
      for (let i = 0; i < 10; i++) {
        try {
          if (args[i] === undefined) break;
          result.push(String(args[i]));
        } catch (e) {
          result.push(`[decoding error at ${i}]`);
          break; // Stop trying after first error
        }
      }
      return JSON.stringify(result);
    } catch (e) {
      return '[serialization error]';
    }
  };

  logger.debug(`Dispatching event: ${eventName}, Block: ${blockNumber}, TxHash: ${transactionHash}, LogIndex: ${logIndex}, Args: ${safeSerializeArgs(eventLogFromEthers.args)}, Timestamp: ${eventTimestamp}`);

  try {
    if (eventName === 'Buy') {
      const buyer = safeGetArg(eventLogFromEthers.args, 'buyer') || safeGetArg(eventLogFromEthers.args, 0);
      const x = safeGetArg(eventLogFromEthers.args, 'x') || safeGetArg(eventLogFromEthers.args, 1);
      const y = safeGetArg(eventLogFromEthers.args, 'y') || safeGetArg(eventLogFromEthers.args, 2);
      const xCoord = ethersInstance.BigNumber.from(x).toNumber();
      const yCoord = ethersInstance.BigNumber.from(y).toNumber();
      await handleBuyEvent(dbClient, contract, logger, ethersInstance, buyer, xCoord, yCoord, eventTimestamp, transactionHash, blockNumber);
    } else if (eventName === 'BatchBuy') {
      const buyer = safeGetArg(eventLogFromEthers.args, 'buyer') || safeGetArg(eventLogFromEthers.args, 0);
      const xArray = safeGetArg(eventLogFromEthers.args, 'x') || safeGetArg(eventLogFromEthers.args, 1);
      const yArray = safeGetArg(eventLogFromEthers.args, 'y') || safeGetArg(eventLogFromEthers.args, 2);
      for (let i = 0; i < xArray.length; i++) {
        const xCoord = ethersInstance.BigNumber.from(xArray[i]).toNumber();
        const yCoord = ethersInstance.BigNumber.from(yArray[i]).toNumber();
        await handleBuyEvent(dbClient, contract, logger, ethersInstance, buyer, xCoord, yCoord, eventTimestamp, transactionHash, blockNumber);
      }
    } else if (eventName === 'Transfer') {
      const from = safeGetArg(eventLogFromEthers.args, 'from') || safeGetArg(eventLogFromEthers.args, 0);
      const to = safeGetArg(eventLogFromEthers.args, 'to') || safeGetArg(eventLogFromEthers.args, 1);
      const tokenId = safeGetArg(eventLogFromEthers.args, 'tokenId') || safeGetArg(eventLogFromEthers.args, 2);
      await handleTransferEvent(dbClient, contract, logger, ethersInstance, from, to, tokenId, eventTimestamp, transactionHash, blockNumber);
    } else if (eventName === 'Update') {
      // Update event has: owner (indexed), x, y, tokenURI
      // The tokenURI is a string and may cause deferred decoding errors
      let updater, xCoord, yCoord, uri;
      
      try {
        // Try named access first
        updater = eventLogFromEthers.args.owner;
        const x = eventLogFromEthers.args.x;
        const y = eventLogFromEthers.args.y;
        uri = eventLogFromEthers.args.tokenURI;
        xCoord = ethersInstance.BigNumber.from(x).toNumber();
        yCoord = ethersInstance.BigNumber.from(y).toNumber();
      } catch (abiError) {
        logger.warn(`ABI decoding failed for Update event, attempting raw decode`, { 
          error: abiError.message, 
          transactionHash,
          blockNumber
        });
        
        // Try raw decoding from topics and data
        // Update event: event Update(address indexed owner, uint256 x, uint256 y, string tokenURI)
        // topics[0] = event signature hash
        // topics[1] = owner (indexed)
        // data = abi.encode(x, y, tokenURI)
        try {
          updater = ethersInstance.utils.getAddress('0x' + topics[1].slice(26)); // Extract address from topic
          const decoded = ethersInstance.utils.defaultAbiCoder.decode(
            ['uint256', 'uint256', 'string'],
            data
          );
          xCoord = decoded[0].toNumber();
          yCoord = decoded[1].toNumber();
          uri = decoded[2];
          logger.info(`Successfully decoded Update event using raw log data`, { xCoord, yCoord, updater, uriPreview: uri?.substring(0, 50) });
        } catch (rawDecodeError) {
          logger.error(`Failed to decode Update event even with raw decoding`, { 
            error: rawDecodeError.message, 
            transactionHash,
            topics: topics?.map(t => t?.substring(0, 20) + '...'),
            dataPreview: data?.substring(0, 100)
          });
          // Skip this event but don't throw - allow other events to continue
          return;
        }
      }
      
      await handleUpdateEvent(dbClient, logger, ethersInstance, updater, xCoord, yCoord, uri, eventTimestamp, transactionHash, blockNumber);
    } else if (eventName === 'OwnershipTransferred') {
      const previousOwner = safeGetArg(eventLogFromEthers.args, 'previousOwner') || safeGetArg(eventLogFromEthers.args, 0);
      const newOwner = safeGetArg(eventLogFromEthers.args, 'newOwner') || safeGetArg(eventLogFromEthers.args, 1);
      await handleOwnershipTransferredEvent(dbClient, logger, ethersInstance, previousOwner, newOwner, eventTimestamp, transactionHash, blockNumber);
    } else if (eventName === 'Named') { // Added handler for Named event
      const user = safeGetArg(eventLogFromEthers.args, 'user') || safeGetArg(eventLogFromEthers.args, 0);
      const nameArg = safeGetArg(eventLogFromEthers.args, 'name') || safeGetArg(eventLogFromEthers.args, 1);

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
    logger.error(`Error during event processing for ${eventName} (tx: ${transactionHash}): ${error.message}`, { stack: error.stack, transactionHash, blockNumber });
    throw error; // Rethrow to ensure transaction in blockProcessor is rolled back for this batch
  }
}