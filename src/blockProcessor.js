import dotenv from 'dotenv';
dotenv.config();
import { CONTRACT_CONFIG, DB_CONFIG } from './config.js';
import pkg from 'pg';
import { ethers } from 'ethers';

const { Pool } = pkg;

console.log('DB_CONFIG:', DB_CONFIG);

const pool = new Pool(DB_CONFIG);
const provider = new ethers.providers.JsonRpcProvider(CONTRACT_CONFIG.provider);
const contract = new ethers.Contract(CONTRACT_CONFIG.address[42170], CONTRACT_CONFIG.abi, provider);

async function getLastProcessedBlock() {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT MAX(block_number) AS last_block FROM events');
    client.release();
    return result.rows[0]?.last_block || 1954820; // Genesis block - 1
  } catch (err) {
    console.error('Error getting last processed block:', err);
    return 0;
  }
}

async function processEventsFromLastBlock() {
  let client;
  try {
    console.log('Starting to process events from last block...');
    const lastBlock = await getLastProcessedBlock();
    const currentBlock = await provider.getBlockNumber();
    console.log(`Last processed block: ${lastBlock}, Current block: ${currentBlock}`);
    const batchSize = 10000; // Adjust the batch size as needed

    for (let startBlock = lastBlock + 1; startBlock <= currentBlock; startBlock += batchSize) {
      const endBlock = Math.min(startBlock + batchSize - 1, currentBlock);
      console.log(`Processing events from block ${startBlock} to ${endBlock}`);
      const events = await contract.queryFilter({}, startBlock, endBlock);

      client = await pool.connect();
      for (const event of events) {
        const { blockNumber, transactionHash, event: eventName, args } = event;

        // Fetch block details to get the timestamp
        const block = await provider.getBlock(blockNumber);
        const timestamp = block.timestamp;

        // Print event details for debugging
        console.log(`Event: ${eventName}, Block: ${blockNumber}, TxHash: ${transactionHash}, Args: ${JSON.stringify(args)}, Timestamp: ${timestamp}`);

        // Insert event
        const insertEventQuery = `
          INSERT INTO events (block_number, transaction_hash, event_type, args, timestamp)
          VALUES ($1, $2, $3, $4, to_timestamp($5))
        `;
        try {
          await client.query(insertEventQuery, [blockNumber, transactionHash, eventName, JSON.stringify(args), timestamp]);
          console.log(`Inserted event: ${eventName}, TxHash: ${transactionHash}`);
        } catch (err) {
          console.error(`Error inserting event: ${eventName}, TxHash: ${transactionHash}`, err);
        }

        // Handle specific event types
        if (eventName === 'Buy') {
          const { buyer, x, y } = args;
          const xCoord = ethers.BigNumber.from(x).toNumber();
          const yCoord = ethers.BigNumber.from(y).toNumber();
          await handleBuyEvent(client, xCoord, yCoord, buyer);
        } else if (eventName === 'BatchBuy') {
          const { buyer, x, y } = args;
          console.log(`Handling BatchBuy event: buyer=${buyer}, x=${x}, y=${y}`);
          for (let i = 0; i < x.length; i++) {
            const xCoord = ethers.BigNumber.from(x[i]).toNumber();
            const yCoord = ethers.BigNumber.from(y[i]).toNumber();
            await handleBuyEvent(client, xCoord, yCoord, buyer);
          }
        } else if (eventName === 'Transfer') {
          const { from, to, tokenId } = args;
          console.log(`Handling Transfer event: from=${from}, to=${to}, tokenId=${tokenId}`);
          // Assuming tokenId is a BigNumber representing the token URI
          const tokenUri = ethers.BigNumber.from(tokenId).toString();
          console.log(`Parsed token URI: ${tokenUri}`);
          if (from.toString() != '0x0000000000000000000000000000000000000000') {
            await handleTransferEvent(client, tokenUri, to);
          }
        } else if (eventName === 'Update') {
          const { 0: from, 1: x, 2: y, 3: uri } = args;
          console.log(`Handling Update event: from=${from}, x=${x}, y=${y}, uri=${uri}`);
          console.log(`Args object: ${JSON.stringify(args)}`);
          const xCoord = ethers.BigNumber.from(x.hex).toNumber();
          const yCoord = ethers.BigNumber.from(y.hex).toNumber();
          console.log(`Parsed coordinates: x=${xCoord}, y=${yCoord}`);
          console.log(`Parsed URI: ${uri}`);
          await handleUpdateEvent(client, xCoord, yCoord, uri, from);
        } else if (eventName === 'OwnershipTransferred') {
          const { previousOwner, newOwner } = args;
          await handleOwnershipTransferredEvent(client, previousOwner, newOwner);
        }
      }
      console.log(`Processed events from block ${startBlock} to ${endBlock}`);
    }
  } catch (err) {
    console.error('Error processing events:', err);
  } finally {
    if (client) {
      client.release();
    }
  }
}

async function handleBuyEvent(client, x, y, owner) {
  console.log(`Handling Buy event: x=${x}, y=${y}, owner=${owner}`);
  const insertPixelBlockQuery = `
    INSERT INTO pixel_blocks (x, y, current_owner)
    VALUES ($1, $2, $3)
    ON CONFLICT (x, y) DO NOTHING;
  `;
  try {
    await client.query(insertPixelBlockQuery, [x, y, owner]);
    console.log(`Inserted pixel block: x=${x}, y=${y}`);
  } catch (err) {
    console.error(`Error inserting pixel block: x=${x}, y=${y}`, err);
  }

  const insertPixelBlockOwnerQuery = `
    INSERT INTO pixel_block_owners (x, y, owner)
    VALUES ($1, $2, $3);
  `;
  try {
    await client.query(insertPixelBlockOwnerQuery, [x, y, owner]);
    console.log(`Inserted pixel block owner: x=${x}, y=${y}, Owner: ${owner}`);
  } catch (err) {
    console.error(`Error inserting pixel block owner: x=${x}, y=${y}, Owner: ${owner}`, err);
  }
}

async function handleTransferEvent(client, tokenUri, to) {
  console.log(`Handling Transfer event: tokenUri=${tokenUri}, to=${to}`);

  // Check if the pixel block exists in the pixel_blocks table
  const checkPixelBlockQuery = `
    SELECT 1 FROM pixel_blocks WHERE uri = $1;
  `;
  const result = await client.query(checkPixelBlockQuery, [tokenUri]);

  if (result.rowCount === 0) {
    console.error(`Error: pixel block (uri=${tokenUri}) does not exist in pixel_blocks table`);
    return;
  }

  const updatePixelBlockOwnerQuery = `
    UPDATE pixel_blocks
    SET current_owner = $1
    WHERE uri = $2;
  `;
  try {
    await client.query(updatePixelBlockOwnerQuery, [to, tokenUri]);
    console.log(`Updated pixel block owner: uri=${tokenUri}, New Owner: ${to}`);
  } catch (err) {
    console.error(`Error updating pixel block owner: uri=${tokenUri}, New Owner: ${to}`, err);
  }

  const insertPixelBlockOwnerQuery = `
    INSERT INTO pixel_block_owners (uri, owner)
    VALUES ($1, $2);
  `;
  try {
    await client.query(insertPixelBlockOwnerQuery, [tokenUri, to]);
    console.log(`Inserted pixel block owner: uri=${tokenUri}, Owner: ${to}`);
  } catch (err) {
    console.error(`Error inserting pixel block owner: uri=${tokenUri}, Owner: ${to}`, err);
  }
}

async function handleUpdateEvent(client, x, y, uri, owner) {
  console.log(`Handling Update event: x=${x}, y=${y}, uri=${uri}, owner=${owner}`);
  
  const updatePixelBlockUriQuery = `
    UPDATE pixel_blocks
    SET uri = $1
    WHERE x = $2 AND y = $3;
  `;
  const insertPixelBlockUriHistoryQuery = `
    INSERT INTO pixel_block_uri_history (x, y, uri, owner)
    VALUES ($1, $2, $3, $4);
  `;
  
  try {
    await client.query(updatePixelBlockUriQuery, [uri, x, y]);
    console.log(`Updated pixel block URI: x=${x}, y=${y}, New URI: ${uri}`);
  } catch (err) {
    console.error(`Error updating pixel block URI: x=${x}, y=${y}, New URI: ${uri}`, err);
  }

  try {
    await client.query(insertPixelBlockUriHistoryQuery, [x, y, uri, owner]);
    console.log(`Inserted pixel block URI history: x=${x}, y=${y}, URI: ${uri}, Owner: ${owner}`);
  } catch (err) {
    console.error(`Error inserting pixel block URI history: x=${x}, y=${y}, URI: ${uri}, Owner: ${owner}`, err);
  }
}

async function handleOwnershipTransferredEvent(client, previousOwner, newOwner) {
  console.log(`Handling OwnershipTransferred event: previousOwner=${previousOwner}, newOwner=${newOwner}`);
  // You can log this information or store it in a separate table if needed
  // For now, we'll just log it
}

async function processTransactionsFromLastBlock() {
  let client;
  try {
    console.log('Starting to process transactions from last block...');
    const lastBlock = await getLastProcessedBlock();
    const currentBlock = await provider.getBlockNumber();
    console.log(`Last processed block: ${lastBlock}, Current block: ${currentBlock}`);

    for (let blockNumber = lastBlock + 1; blockNumber <= currentBlock; blockNumber++) {
      const block = await provider.getBlockWithTransactions(blockNumber);

      client = await pool.connect();
      for (const tx of block.transactions) {
        if (tx.to && tx.to.toLowerCase() === CONTRACT_CONFIG.address[42170].toLowerCase()) {
          // Print transaction details for debugging
          console.log(`Transaction: ${tx.hash}, Block: ${blockNumber}, From: ${tx.from}, To: ${tx.to}, Value: ${tx.value.toString()}`);

          // Insert transaction
          const insertTransactionQuery = `
            INSERT INTO transactions (block_number, transaction_hash, from_address, to_address, value, timestamp)
            VALUES ($1, $2, $3, $4, $5, to_timestamp($6))
          `;
          try {
            await client.query(insertTransactionQuery, [blockNumber, tx.hash, tx.from, tx.to, tx.value.toString(), block.timestamp]);
            console.log(`Inserted transaction: ${tx.hash}`);
          } catch (err) {
            console.error(`Error inserting transaction: ${tx.hash}`, err);
          }
        }
      }
      console.log(`Recorded transactions from block ${blockNumber}`);
    }
  } catch (err) {
    console.error('Error processing transactions:', err);
  } finally {
    if (client) {
      client.release();
    }
  }
}

export { getLastProcessedBlock, processEventsFromLastBlock, processTransactionsFromLastBlock };