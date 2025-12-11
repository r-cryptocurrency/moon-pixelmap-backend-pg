import dotenv from 'dotenv';
dotenv.config();
import { ethers } from 'ethers';
import { createChildLogger } from './logger.js';

const logger = createChildLogger('rpcProvider');

// Arbitrum Nova RPC endpoints - ordered by priority
// Free public endpoints first, paid endpoints as fallback
const RPC_ENDPOINTS = [
  // Free public endpoints (primary)
  'https://nova.arbitrum.io/rpc',
  'https://arbitrum-nova.drpc.org', 
  'https://arbitrum-nova.public.blastapi.io',
  'https://rpc.ankr.com/arbitrumnova',
  // Alchemy as fallback (when available)
  process.env.ALCHEMY_URL,
].filter(Boolean); // Remove undefined/null entries

// Provider state
let currentProviderIndex = 0;
let provider = null;
let lastProviderSwitch = 0;
const MIN_SWITCH_INTERVAL = 60000; // Don't switch providers more than once per minute

// Retry configuration
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000; // 1 second
const MAX_RETRY_DELAY = 30000; // 30 seconds

/**
 * Creates a new provider for the given RPC URL
 */
function createProvider(rpcUrl) {
  if (!rpcUrl) return null;
  try {
    return new ethers.providers.JsonRpcProvider(rpcUrl, {
      chainId: 42170,
      name: 'arbitrum-nova'
    });
  } catch (err) {
    logger.error(`Failed to create provider for ${rpcUrl}`, { error: err.message });
    return null;
  }
}

/**
 * Gets the current active provider, creating one if necessary
 */
function getProvider() {
  if (!provider && RPC_ENDPOINTS.length > 0) {
    provider = createProvider(RPC_ENDPOINTS[currentProviderIndex]);
    logger.info(`Initialized RPC provider with endpoint ${currentProviderIndex + 1}/${RPC_ENDPOINTS.length}: ${RPC_ENDPOINTS[currentProviderIndex]}`);
  }
  return provider;
}

/**
 * Switches to the next available RPC provider
 */
function switchToNextProvider() {
  const now = Date.now();
  
  // Avoid rapid switching
  if (now - lastProviderSwitch < MIN_SWITCH_INTERVAL) {
    logger.debug('Skipping provider switch - too soon since last switch');
    return false;
  }

  const previousIndex = currentProviderIndex;
  currentProviderIndex = (currentProviderIndex + 1) % RPC_ENDPOINTS.length;
  
  // If we've cycled through all providers, wait before retrying the first one
  if (currentProviderIndex === 0 && previousIndex === RPC_ENDPOINTS.length - 1) {
    logger.warn('All RPC endpoints have been tried. Cycling back to first endpoint.');
  }
  
  provider = createProvider(RPC_ENDPOINTS[currentProviderIndex]);
  lastProviderSwitch = now;
  
  logger.info(`Switched to RPC provider ${currentProviderIndex + 1}/${RPC_ENDPOINTS.length}: ${RPC_ENDPOINTS[currentProviderIndex]}`);
  return true;
}

/**
 * Checks if an error is a rate limit or connection error that warrants switching providers
 */
function isProviderError(error) {
  if (!error) return false;
  
  const message = error.message?.toLowerCase() || '';
  const code = error.code;
  
  return (
    // Rate limiting
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes('429') ||
    code === 429 ||
    // Connection errors
    message.includes('econnrefused') ||
    message.includes('econnreset') ||
    message.includes('etimedout') ||
    message.includes('socket hang up') ||
    message.includes('network error') ||
    code === 'NETWORK_ERROR' ||
    code === 'TIMEOUT' ||
    code === 'SERVER_ERROR' ||
    // Capacity errors
    message.includes('capacity') ||
    message.includes('unavailable') ||
    // Bad gateway / service unavailable
    message.includes('502') ||
    message.includes('503') ||
    message.includes('504')
  );
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculates delay with exponential backoff
 */
function getRetryDelay(attempt) {
  const delay = Math.min(INITIAL_RETRY_DELAY * Math.pow(2, attempt), MAX_RETRY_DELAY);
  // Add jitter (±25%)
  const jitter = delay * 0.25 * (Math.random() * 2 - 1);
  return Math.floor(delay + jitter);
}

/**
 * Executes an RPC call with retry logic and automatic provider failover
 * @param {Function} rpcCall - Async function that takes a provider and returns a result
 * @param {string} operationName - Name of the operation for logging
 * @returns {Promise<any>} - Result of the RPC call
 */
async function executeWithRetry(rpcCall, operationName = 'RPC call') {
  let lastError = null;
  let totalAttempts = 0;
  const maxTotalAttempts = MAX_RETRIES * RPC_ENDPOINTS.length;

  while (totalAttempts < maxTotalAttempts) {
    const currentProvider = getProvider();
    
    if (!currentProvider) {
      throw new Error('No RPC provider available');
    }

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      totalAttempts++;
      
      try {
        const result = await rpcCall(currentProvider);
        return result;
      } catch (error) {
        lastError = error;
        
        logger.warn(`${operationName} failed (attempt ${attempt + 1}/${MAX_RETRIES})`, {
          error: error.message,
          provider: RPC_ENDPOINTS[currentProviderIndex],
          code: error.code
        });

        // Check if this is a provider-level error that warrants switching
        if (isProviderError(error)) {
          // If we still have retries left with current provider, try again
          if (attempt < MAX_RETRIES - 1) {
            const delay = getRetryDelay(attempt);
            logger.debug(`Retrying in ${delay}ms...`);
            await sleep(delay);
            continue;
          }
          
          // Switch to next provider
          if (switchToNextProvider()) {
            break; // Break inner loop to try new provider
          }
        } else {
          // For non-provider errors (e.g., ABI decoding), don't retry or switch
          throw error;
        }
      }
    }
  }

  logger.error(`${operationName} failed after exhausting all retries and providers`, {
    error: lastError?.message,
    totalAttempts
  });
  throw lastError;
}

/**
 * Wrapper around provider.getBlockNumber() with retry logic
 */
async function getBlockNumber() {
  return executeWithRetry(
    async (p) => p.getBlockNumber(),
    'getBlockNumber'
  );
}

/**
 * Wrapper around provider.getBlock() with retry logic
 */
async function getBlock(blockNumber) {
  return executeWithRetry(
    async (p) => p.getBlock(blockNumber),
    `getBlock(${blockNumber})`
  );
}

/**
 * Wrapper around provider.getBlockWithTransactions() with retry logic
 */
async function getBlockWithTransactions(blockNumber) {
  return executeWithRetry(
    async (p) => p.getBlockWithTransactions(blockNumber),
    `getBlockWithTransactions(${blockNumber})`
  );
}

/**
 * Creates a contract instance that uses the fallback provider system
 */
function createContractWithFallback(address, abi) {
  const p = getProvider();
  if (!p) {
    throw new Error('No RPC provider available');
  }
  return new ethers.Contract(address, abi, p);
}

/**
 * Query contract events with retry logic
 */
async function queryContractEvents(contract, filterOrTopic, fromBlock, toBlock) {
  return executeWithRetry(
    async (p) => {
      // Reconnect contract to current provider
      const contractWithProvider = contract.connect(p);
      return contractWithProvider.queryFilter(filterOrTopic, fromBlock, toBlock);
    },
    `queryEvents(${fromBlock}-${toBlock})`
  );
}

/**
 * Call a contract read method with retry logic
 */
async function callContractMethod(contract, methodName, ...args) {
  return executeWithRetry(
    async (p) => {
      const contractWithProvider = contract.connect(p);
      return contractWithProvider[methodName](...args);
    },
    `contract.${methodName}()`
  );
}

/**
 * Get current provider stats
 */
function getProviderStats() {
  return {
    currentEndpoint: RPC_ENDPOINTS[currentProviderIndex] || 'none',
    currentIndex: currentProviderIndex,
    totalEndpoints: RPC_ENDPOINTS.length,
    endpoints: RPC_ENDPOINTS.map((url, i) => ({
      index: i,
      url: url?.substring(0, 50) + (url?.length > 50 ? '...' : ''),
      active: i === currentProviderIndex
    }))
  };
}

/**
 * Force switch to next provider (for testing or manual intervention)
 */
function forceProviderSwitch() {
  lastProviderSwitch = 0; // Reset cooldown
  return switchToNextProvider();
}

export {
  getProvider,
  getBlockNumber,
  getBlock,
  getBlockWithTransactions,
  createContractWithFallback,
  queryContractEvents,
  callContractMethod,
  executeWithRetry,
  getProviderStats,
  forceProviderSwitch,
  RPC_ENDPOINTS
};
