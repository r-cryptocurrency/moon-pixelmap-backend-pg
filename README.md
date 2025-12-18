# MOONPLACE PIXEL MAP BACKEND (PostgreSQL + WebSocket)

## Current Status (as of December 18, 2025)

✅ **Working Features:**
- Express.js REST API with PostgreSQL database
- Blockchain event monitoring (Arbitrum Nova with automatic RPC failover)
- Real-time WebSocket chat server
- Pixel map image generation and caching
- Security hardening (SQL injection prevention, rate limiting, input validation)
- Batch pixel updates with ownership verification
- Event processing and data synchronization with error recovery
- Comprehensive logging system with **automatic log rotation**
- Status API with RPC provider information

✅ **Recently Implemented (Dec 18, 2025):**
- **Security & Maintenance Updates:**
  - Audited and updated all dependencies to resolve critical vulnerabilities.
  - Implemented **Log Rotation** using `winston-daily-rotate-file` to prevent disk space exhaustion. Logs are now compressed and retained for 14 days.
  - Added `systemd` service configuration for robust production deployment.

✅ **Previously Implemented (Dec 10, 2025):**
- **Fallback RPC Provider System:**
  - Automatic provider switching on rate limits or connection errors
  - 5+ RPC endpoints (Alchemy + 4 free public endpoints)
  - Exponential backoff with jitter for retries
  - Provider health detection for rate limits and network errors
  - Separate `src/utils/rpcProvider.js` module for provider management
  - Status API shows current RPC endpoint and sync progress
- **ABI Decoding Error Handling:**
  - Safe event argument access to prevent deferred decoding errors
  - Raw log decoder fallback for Update events
  - Events continue processing even if individual events fail
- **Configuration Security:**
  - Removed hardcoded API keys
  - All sensitive values read from environment variables
  - Multiple RPC URLs in configuration

✅ **Previously Implemented (Oct 31, 2025):**
- **Real-Time Chat System:**
  - WebSocket server on `/ws/chat`
  - Ephemeral message storage (last 50 messages in memory)
  - Rate limiting (3 messages per 5 seconds per IP)
  - Message validation and sanitization
  - User count broadcasting
  - Anonymous and wallet-based messaging
- **Security Enhancements:**
  - SQL injection prevention with parameterized queries
  - Input validation middleware (`validateCoords`, `validateAddressInBody`, `validateImageInBody`)
  - Rate limiting (300 req/15min general, 20 req/15min writes)
  - Address format validation (Ethereum 0x[40 hex])
  - Coordinate validation (0-99 range)
- **Batch Pixel Updates:**
  - Update multiple pixels in a single transaction
  - Individual image per pixel (automatic splitting)
  - Ownership validation for all selected pixels
  - Transaction rollback on failure
- **Performance Optimizations:**
  - Increased rate limits for development (300 vs 100)
  - Optimized image processing
  - Efficient database queries

⚠️ **Known Issues:**
- Large log files (combined.log grows quickly)
- Some npm audit vulnerabilities (non-critical)
- No WebSocket authentication yet
- Chat history not persistent (in-memory only)

## 1. Overview

The MOONPLACE Pixel Map Backend is a Node.js application built with Express.js, PostgreSQL, and WebSocket. It serves as the backend for the MOONPLACE pixel map project. Its primary responsibilities include:

*   **Blockchain Event Monitoring**: Continuously scans the Arbitrum Nova blockchain (via Alchemy) for events emitted by the deployed `PixelMap.sol` smart contract.
*   **Data Persistence**: Stores processed event data, pixel block states (current owner, URI), ownership history, URI update history, and user names into a PostgreSQL database.
*   **Image Generation**: Periodically fetches pixel data from the database, retrieves individual pixel images (from URIs, including base64 encoded JSON data URIs), and generates a composite PNG image of the entire 100x100 pixel map.
*   **Real-Time Chat**: WebSocket server providing ephemeral chat with rate limiting and message history.
*   **API Service**: Exposes RESTful API endpoints to:
    *   Serve the generated pixel map image
    *   Provide detailed JSON data for all minted pixel blocks
    *   Provide data for individual pixel blocks
    *   Handle pixel updates (single and batch)
    *   Report the application's synchronization status

The backend is designed to ensure data consistency between the blockchain state and the local database, providing a reliable and secure data source for the frontend application.

## 2. Setup

1.  **PostgreSQL Database**:
    *   Ensure you have a PostgreSQL server running.
    *   Create a dedicated database and a user with appropriate permissions.
2.  **Environment Variables**:
    *   Copy the `example.env` file to a new file named `.env`.
    *   Update the `.env` file with your PostgreSQL credentials and RPC configuration:
    ```env
    # Database Configuration
    DB_HOST=localhost
    DB_PORT=5432
    DB_NAME=moonplace
    DB_USER=postgres
    DB_PASSWORD=your_password_here
    
    # RPC Configuration (optional - uses free public RPCs if not set)
    # Set ALCHEMY_URL if you have an Alchemy account for better performance
    ALCHEMY_URL=https://arb-nova.g.alchemy.com/v2/your_api_key
    # Otherwise, the backend automatically uses free public RPC endpoints
    
    # Server Configuration
    PORT=3001
    
    # Event Processing
    EVENT_BATCH_SIZE=10  # Lower for rate-limited endpoints, higher for dedicated RPCs
    ARBITRUM_NOVA_GENESIS_BLOCK=1954820
    
    # Logging
    LOG_LEVEL=info
    ```
    *   **RPC Configuration Details**:
        *   If `ALCHEMY_URL` is set, it will be used as the primary endpoint
        *   If not set, the backend automatically uses free public RPC endpoints:
            - `https://nova.arbitrum.io/rpc` (Official Arbitrum Nova)
            - `https://arbitrum-nova.drpc.org` (dRPC)
            - `https://arbitrum-nova.public.blastapi.io` (BlastAPI)
            - `https://rpc.ankr.com/arbitrumnova` (Ankr)
        *   The system automatically switches providers on rate limits or connection errors
        *   `EVENT_BATCH_SIZE`: Use 10 for Alchemy free tier or public RPCs, increase to 50+ for dedicated endpoints
3.  **Install Dependencies**:
    ```bash
    npm install
    ```
4.  **Initialize Database**:
    *   The application will attempt to create the necessary tables on startup if they don't exist.
    *   To manually reset and recreate all tables, run:
    ```bash
    npm run reset-db
    ```
    This script drops all existing tables (CASCADE) and then recreates them according to the schema defined in `src/utils/db.js`.

5.  **Run the Application**:
    *   For development (with Nodemon, if configured):
        ```bash
        npm run dev
        ```
    *   For production:
        ```bash
        npm start
        ```

## 3. Project Structure

```
moon-pixelmap-backend-pg/
├── logs/                     # Log files generated by Winston
│   ├── combined.log
│   ├── errors.log
│   ├── exceptions.log
│   └── rejections.log
├── src/
│   ├── config.js             # Configuration (DB, Alchemy, Contract ABI/Addresses)
│   ├── index.js              # Main application entry point (Express server setup)
│   ├── routes/               # Express route handlers
│   │   ├── pixelmap.js       # API for the full pixel map image
│   │   ├── pixels.js         # API for individual and all pixel data (JSON)
│   │   └── status.js         # API for application status
│   ├── scripts/
│   │   └── resetDb.js        # Script to reset and initialize the database
│   ├── services/
│   │   └── eventProcessor.js # Logic for processing specific blockchain events
   └── utils/
       ├── blockProcessor.js # Scans blockchain for new events
       ├── db.js             # Database connection, table creation/reset
       ├── imageGenerator.js # Generates the composite pixel map image
       ├── imageProcessor.js # (Currently seems unused or legacy)
       ├── logger.js         # Winston logger configuration
       └── rpcProvider.js    # RPC provider management with automatic failover
├── .env                      # Environment variables (ignored by git)
├── example.env               # Example environment file
├── package.json              # Project dependencies and scripts
└── README.md                 # This file
```

## 4. Key Components and Functions

### `src/index.js`
*   Initializes the Express application.
*   Sets up middleware (CORS, JSON parsing, request logging).
*   Mounts API routes from the `src/routes/` directory.
*   Starts the blockchain event processing loop (`processEventsFromLastBlock`).
*   Starts the periodic image generation (`startImageGenerationInterval`).

### `src/config.js`
*   `DB_CONFIG`: Database connection parameters (read from `.env`).
*   `SERVER_CONFIG`: Server configuration (e.g., port).
*   `alchemySettings`: Alchemy API settings (API key from `ALCHEMY_API_KEY` env var).
*   `arbitrumNova`: Network configuration including RPC URLs for fallback:
    *   Primary: `ALCHEMY_URL` environment variable (if set)
    *   Fallback endpoints: 4 free public RPC URLs
*   `CONTRACT_CONFIG`:
    *   `provider`: Primary RPC URL (uses `ALCHEMY_URL` or falls back to official Nova RPC).
    *   `address`: Deployed smart contract addresses (keyed by network ID).
    *   `abi`: The ABI (Application Binary Interface) of the `PixelMap.sol` smart contract.

### `src/utils/db.js`
*   `pool`: `pg.Pool` instance for database connections.
*   `createTables()`:
    *   Defines and executes `CREATE TABLE IF NOT EXISTS` statements for:
        *   `events`: Stores raw event data from the smart contract (unique by `transaction_hash`, `log_index`).
        *   `pixel_blocks`: Stores the current state of each pixel block (x, y, URI, current owner, timestamps).
        *   `pixel_block_owners`: History of ownership for each pixel block.
        *   `pixel_block_uri_history`: History of URI updates for each pixel block.
        *   `transactions`: (Potentially for storing general transaction info - usage might need review).
        *   `users`: Stores user addresses and their associated names from the `Named` event.
    *   Creates PL/pgSQL trigger functions and triggers to automatically update `updated_at` timestamps on row updates for `pixel_blocks` and `users`.
*   `resetDatabase()`: Drops all relevant tables (using `CASCADE` to handle foreign key dependencies).

### `src/utils/rpcProvider.js`
*   **New module for managing RPC provider failover and retry logic**
*   Key Features:
    *   Multiple RPC endpoints: Alchemy (primary) + 4 public endpoints (fallback)
    *   Automatic provider switching on rate limits (HTTP 429) or connection errors
    *   Exponential backoff with jitter for failed requests
    *   Provider health detection:
        - Rate limit errors (429, "too many requests")
        - Connection errors (ECONNREFUSED, ECONNRESET, ETIMEDOUT)
        - Service unavailable (502, 503, 504)
    *   Helper functions:
        - `getBlockNumber()`: Get current block with retry logic
        - `getBlock(blockNumber)`: Get block details with failover
        - `getBlockWithTransactions(blockNumber)`: Get block with tx data
        - `queryContractEvents(contract, filter, fromBlock, toBlock)`: Query events with retry
        - `callContractMethod(contract, methodName, ...args)`: Call contract methods with failover
        - `getProviderStats()`: Get current provider status
        - `forceProviderSwitch()`: Manually switch to next provider
*   Configuration:
    *   `MIN_SWITCH_INTERVAL`: 60 seconds (prevents rapid provider thrashing)
    *   `MAX_RETRIES`: 3 attempts per provider
    *   `INITIAL_RETRY_DELAY`: 1 second with exponential backoff up to 30 seconds
    *   Each failed request adds jitter (±25%) to prevent thundering herd

### `src/utils/blockProcessor.js`
*   `getLastProcessedBlock()`: Retrieves the last successfully processed block number from the `events` table or returns a default starting block.
*   `processEventsFromLastBlock()`:
    *   Fetches new blocks from the blockchain using the RPC provider system.
    *   Automatically switches RPC providers on rate limits or connection failures.
    *   Retrieves all relevant smart contract events within blocks (batched to respect provider limits).
    *   Fetches block timestamps (with automatic failover to next provider on error).
    *   Processes events in batches, wrapped in database transactions:
        *   Inserts raw event data into the `events` table.
        *   Delegates event-specific logic to `processEventLog()` in `src/services/eventProcessor.js`.
        *   If an event fails to decode, logs the error but continues processing other events.
    *   Updates the record of the last processed block.
    *   All RPC calls automatically retry with exponential backoff before switching providers.
*   `EVENT_BATCH_SIZE`: Configurable via env var (default: 10 for rate-limited endpoints, can be 50+ for dedicated RPCs).

### `src/services/eventProcessor.js`
*   **Event Processing with Error Recovery**
    *   Safe argument access to prevent deferred ABI decoding errors
    *   Raw log decoding fallback for problematic events
    *   Individual events that fail are skipped (not thrown) to allow batch processing to continue
*   `convertTokenIdToXY(tokenId)`: Converts a `tokenId` to `{x, y}` coordinates.
*   `calculateTokenId(x, y)`: Converts `{x, y}` coordinates to a `tokenId`.
*   `processEventLog(eventLogFromEthers, eventTimestamp, dbClient, contract, logger, ethersInstance)`:
    *   Main dispatcher function that routes event data to specific handler functions based on `eventName`.
    *   Uses `safeGetArg()` helper to catch deferred ABI decoding errors for each argument access.
    *   For `Update` events: If normal decoding fails, attempts raw log decoding using `ethers.utils.defaultAbiCoder.decode()` as fallback.
*   `handleBuyEvent(..., buyer, x, y, ...)`:
    *   Called for `Buy` and `BatchBuy` events.
    *   Fetches `tokenURI` from the contract for the given `x, y`.
    *   Upserts data into `pixel_blocks` (owner, URI).
    *   Inserts into `pixel_block_owners` history.
*   `handleTransferEvent(..., from, to, tokenId, ...)`:
    *   Called for `Transfer` events.
    *   If `from` is the zero address (mint):
        *   Fetches `tokenURI`.
        *   Upserts into `pixel_blocks` (owner, URI, ensuring `created_at` is set).
    *   If a regular transfer:
        *   Updates `current_owner` in `pixel_blocks`.
    *   Inserts into `pixel_block_owners` history for both cases.
*   `handleUpdateEvent(..., updater, x, y, uri, ...)`:
    *   Called for `Update` events.
    *   Updates `uri` and `timestamp` in `pixel_blocks` for the given `x, y` (verifies `updater` is `current_owner`).
    *   Inserts the new URI, owner, and timestamp into `pixel_block_uri_history`.
*   `handleNamedEvent(..., user, name, ...)`:
    *   Called for `Named` events.
    *   Upserts the `user` address and `name` into the `users` table.
*   `handleOwnershipTransferredEvent(...)`:
    *   Logs contract ownership changes (not pixel ownership).

### `src/utils/imageGenerator.js`
*   `generatePixelMapImage()`:
    *   Creates a 1000x1000 canvas (100x100 blocks, each 10x10 pixels).
    *   Draws a default background/grid.
    *   Fetches all `pixel_blocks` with non-null URIs from the database.
    *   For each pixel block:
        *   If the URI is a `data:application/json;base64,...` string, it decodes it, parses the JSON, and extracts the actual image URI from the `image` field.
        *   Loads the image from the (potentially extracted) URI using `canvas.loadImage()`.
        *   Draws the loaded image onto the main canvas at the correct `x, y` position.
    *   Caches the generated canvas buffer (`imageCache`).
    *   Logs detailed statistics about URI processing.
*   `getPixelMapImage()`: Returns the `imageCache` if available.
*   `startImageGenerationInterval(intervalMs)`: Periodically calls `generatePixelMapImage()` to keep the cache fresh.

### `src/utils/logger.js`
*   Configures a Winston logger instance with multiple transports (console, file for combined logs, file for errors, etc.).
*   Provides a `createChildLogger(serviceName)` helper to create context-specific loggers.

### `src/routes/`
*   **`pixelmap.js` (`/api/pixelmap`)**:
    *   `GET /`: Serves the cached pixel map PNG image generated by `imageGenerator.js`. Includes ETag and Last-Modified headers for caching.
*   **`pixels.js` (`/api/pixels`)**:
    *   `GET /`: Returns a JSON array of all pixel blocks from the `pixel_blocks` table (x, y, URI, current owner, timestamp) where `current_owner` is not null.
    *   `GET /:x/:y`: Returns JSON data for a specific pixel block. **Protected with coordinate validation (0-99 range).**
*   **`pixels-update.js` (`/api/pixels-update`)** - **Write Rate Limited (20/15min)**:
    *   `POST /`: Batch update multiple pixels. **Protected with:**
        - Input validation middleware (coordinates, address, image per pixel)
        - Ownership verification for all selected pixels
        - Transaction rollback on failure
        - Parameterized queries to prevent SQL injection
    *   `POST /:x/:y`: Update single pixel. **Protected with:**
        - Coordinate validation (0-99 range)
        - Address validation (Ethereum format)
        - Image validation (size limits)
        - Ownership verification
*   **`users.js` (`/api/users`)**:
    *   `POST /`: Creates or updates user connection. **Protected with address validation.**
    *   `GET /:address`: Returns user data for a specific address. **Protected with address validation.**
*   **`status.js` (`/api/status`)**:
    *   `GET /`: Returns a JSON object with the current application status, including:
        - Database connection status
        - Last processed block number from the blockchain
        - Current RPC provider endpoint being used
        - RPC endpoint index (e.g., "2/5" meaning 2nd of 5 available)
        - Current block number on the blockchain
        - Number of blocks remaining to sync
        - Service health status

### `src/services/chatServer.js`
*   **WebSocket Chat Server** (path: `/ws/chat`):
    *   Handles WebSocket connections for real-time chat
    *   Features:
        - Ephemeral message storage (last 50 messages in memory)
        - Message broadcasting to all connected clients
        - Rate limiting (3 messages per 5 seconds per IP)
        - Message validation and sanitization (500 char limit)
        - User count broadcasting
        - Support for anonymous and wallet-based messaging
        - Connection/disconnection logging
    *   Message Types:
        - `history`: Sent to new clients with last 50 messages
        - `message`: Broadcast when new message received
        - `userCount`: Broadcast when user connects/disconnects
        - `error`: Sent to client on validation failure or rate limit

### `src/utils/validation.js`
*   **Input validation middleware** to prevent injection attacks:
    *   `validateCoords`: Validates x,y coordinates are integers 0-99
    *   `validateAddressInBody`: Validates Ethereum address format (0x[40 hex chars])
    *   `validateImageInBody`: Validates base64 image data and size limits
    *   `validateAddressInParams`: Validates Ethereum address format in URL params
    *   `validateImageInBody`: Validates base64 image data and size limits (200KB max)

## 5. Database Schema

The database schema is defined and managed in `src/utils/db.js`. Key tables include:

*   **`events`**: Stores raw event data from the smart contract.
    *   `id, block_number, transaction_hash, log_index, event_type, args, timestamp`
*   **`pixel_blocks`**: Current state of each pixel on the map.
    *   `id, x, y, uri, current_owner, timestamp, created_at, updated_at`
    *   Unique constraint on `(x, y)`.
*   **`pixel_block_owners`**: History of ownership changes.
    *   `id, x, y, owner, timestamp, transaction_hash, block_number`
    *   Foreign key `(x, y)` references `pixel_blocks(x, y)`.
*   **`pixel_block_uri_history`**: History of URI updates for pixels.
    *   `id, x, y, uri, owner, timestamp, transaction_hash, block_number`
    *   Foreign key `(x, y)` references `pixel_blocks(x, y)`.
*   **`transactions`**: General transaction information (currently minimal usage).
    *   `id, block_number, transaction_hash, from_address, to_address, value, timestamp`
*   **`users`**: Stores user addresses and associated names.
    *   `id, address, user_name, created_at, updated_at`
    *   Unique constraint on `address`.

Triggers are in place to automatically update the `updated_at` fields in `pixel_blocks` and `users` tables whenever a row is updated.

# MOONPLACE PIXEL MAP BACKEND (PostgreSQL + WebSocket)

## TODO Lists

### 🔴 Immediate (High Priority):
1. ✅ ~~**Fix SQL injection**~~ - COMPLETED (parameterized queries + validation middleware)
2. ✅ ~~**Add rate limiting**~~ - COMPLETED (300/15min general, 20/15min writes, 3msg/5sec chat)
3. ✅ ~~**Add input validation**~~ - COMPLETED (`src/utils/validation.js`)
4. ✅ ~~**Implement real-time chat**~~ - COMPLETED (WebSocket server with ephemeral history)
5. ✅ ~~**Add batch pixel updates**~~ - COMPLETED (transaction-based multi-pixel updates)
6. **Implement API authentication** (API keys or JWT for sensitive endpoints)
7. **Restrict CORS** origins for production (currently allows all)
8. **Add log rotation** (combined.log growing too large)
9. **WebSocket authentication** (verify wallet signatures for chat)

### 🟡 Near Term (1-2 weeks):
1. **Persistent chat history**:
   - Store messages in database
   - Configurable retention period
   - Message search/filtering
2. **Chat moderation tools**:
   - Admin commands
   - Ban/mute functionality
   - Message deletion
3. **Enhanced validation**:
   - Image format validation
   - Content type checking
   - File size limits per pixel count
4. **Performance optimization**:
   - Database query optimization
   - Connection pooling tuning
   - Image generation caching improvements
5. **Monitoring and alerts**:
   - Health check endpoint
   - Error rate monitoring
   - Database connection monitoring
6. **Fix Named event handling** - store actual names, not just hash

### 🟢 Long Term (1+ month):
1. **API versioning** (v1, v2 routes)
2. **GraphQL API** as alternative to REST
3. **Horizontal scaling** preparation:
   - Redis for session/chat state
   - Load balancer compatibility
   - Stateless architecture
4. **Advanced analytics**:
   - Pixel update frequency
   - User activity metrics
   - Popular areas tracking
5. **Backup and recovery**:
   - Automated database backups
   - Disaster recovery procedures
6. **CI/CD pipeline** setup

## 6. Security Features

### Input Validation
- **Coordinate validation**: Ensures x,y are integers in range 0-99
- **Address validation**: Validates Ethereum address format (0x[40 hex])
- **Image validation**: Checks base64 format and size limits
- All validation failures return proper HTTP 400 errors

### Rate Limiting
- **General endpoints**: 300 requests per 15 minutes per IP
- **Write operations**: 20 requests per 15 minutes per IP
- **Chat messages**: 3 messages per 5 seconds per IP
- Rate limit headers included in responses
- Violations logged to Winston logger

### SQL Injection Prevention
- All database queries use parameterized statements
- No string concatenation for SQL queries
- Input sanitization before database operations

### CORS Configuration
- Currently allows all origins (development mode)
- Should be restricted for production deployment
- Credentials not allowed by default

## 7. Rate Limit Configuration

Edit `src/index.js` to adjust rate limits:

```javascript
// General rate limiter
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // requests per window
});

// Write operations rate limiter
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // requests per window
});

// Chat rate limiter (in chatServer.js)
const RATE_LIMIT_WINDOW = 5000; // 5 seconds
const RATE_LIMIT_MAX = 3; // messages per window
```
7. **Add helmet middleware** for security headers
8. **Address npm audit vulnerabilities** (13 found: 2 low, 1 moderate, 8 high, 2 critical)

### 🟡 Near Term (1-2 weeks):
1. **Add WebSocket support** for real-time updates
2. **Implement chat system backend**:
   - Create chat tables in PostgreSQL
   - Add Socket.IO server
   - User authentication for chat
3. **Add database connection pooling config**
4. **Implement image validation and size limits**
5. **Add API documentation** (Swagger/OpenAPI)
6. **Create health check endpoint**
7. **Add metrics collection** (Prometheus)

### 🟢 Long Term (1+ month):
1. **Implement caching layer** (Redis)
2. **Add GraphQL API** alongside REST
3. **Create admin dashboard backend**
4. **Add analytics and reporting**
5. **Implement IPFS integration** for decentralized storage
6. **Add notification system** for pixel updates
7. **Create backup and recovery system**

## 8. Production Deployment with Systemd

We recommend running the application using `systemd` with a dedicated user for better security and process management.

### 1. Create a Dedicated User
Create a user named `node-moonplace` with no login access:
```bash
sudo useradd -r -m -s /bin/false node-moonplace
```

### 2. Setup Application Code
Clone or move the repository to the user's home directory:
```bash
# Assuming code is currently in /home/jw/src/moonplace
sudo cp -r /home/jw/src/moonplace /home/node-moonplace/
sudo chown -R node-moonplace:node-moonplace /home/node-moonplace/moonplace
```

### 3. Install Dependencies
Switch to the user (temporarily enabling shell if needed, or use sudo) to install dependencies:
```bash
sudo -u node-moonplace bash -c 'cd /home/node-moonplace/moonplace/moon-pixelmap-backend-pg && npm install --production'
```

### 4. Configure Systemd Service
Copy the provided service file to the systemd directory:
```bash
sudo cp /home/node-moonplace/moonplace/systemd/moon-pixelmap-backend.service /etc/systemd/system/
sudo systemctl daemon-reload
```

### 5. Start and Enable Service
```bash
sudo systemctl start moon-pixelmap-backend
sudo systemctl enable moon-pixelmap-backend
```

### 6. View Logs
View logs using journalctl:
```bash
sudo journalctl -u moon-pixelmap-backend -f
```
