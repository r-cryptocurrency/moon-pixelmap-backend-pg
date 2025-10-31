import { WebSocketServer } from 'ws';
import logger from '../utils/logger.js';

// Store last 50 messages in memory
const messageHistory = [];
const MAX_HISTORY = 50;

// Rate limiting per connection
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 5000; // 5 seconds
const RATE_LIMIT_MAX = 3; // 3 messages per window

class ChatServer {
  constructor() {
    this.wss = null;
    this.clients = new Set();
  }

  initialize(server) {
    this.wss = new WebSocketServer({ 
      server,
      path: '/ws/chat'
    });

    this.wss.on('connection', (ws, req) => {
      const clientIp = req.socket.remoteAddress;
      logger.info('New chat connection', { ip: clientIp });
      
      this.clients.add(ws);

      // Send message history to new client
      ws.send(JSON.stringify({
        type: 'history',
        messages: messageHistory
      }));

      // Send user count
      this.broadcastUserCount();

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(ws, message, clientIp);
        } catch (error) {
          logger.error('Error parsing chat message', { error: error.message });
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Invalid message format'
          }));
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        this.broadcastUserCount();
        logger.info('Chat connection closed', { ip: clientIp });
      });

      ws.on('error', (error) => {
        logger.error('WebSocket error', { error: error.message });
      });
    });

    logger.info('Chat WebSocket server initialized on /ws/chat');
  }

  handleMessage(ws, message, clientIp) {
    // Rate limiting
    if (!this.checkRateLimit(clientIp)) {
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Slow down! Too many messages.'
      }));
      return;
    }

    if (message.type === 'chat') {
      const { text, address } = message;

      // Validate message
      if (!text || typeof text !== 'string') {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Invalid message text'
        }));
        return;
      }

      // Validate address format (optional - can be anonymous)
      if (address && !/^0x[a-fA-F0-9]{40}$/.test(address)) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Invalid address format'
        }));
        return;
      }

      // Sanitize and limit message length
      const sanitizedText = text.slice(0, 500).trim();
      if (!sanitizedText) {
        return;
      }

      // Create message object
      const chatMessage = {
        id: Date.now() + Math.random().toString(36).substr(2, 9),
        user: address ? this.formatAddress(address) : 'Anonymous',
        fullAddress: address || null,
        message: sanitizedText,
        timestamp: new Date().toISOString()
      };

      // Add to history
      messageHistory.push(chatMessage);
      if (messageHistory.length > MAX_HISTORY) {
        messageHistory.shift();
      }

      // Broadcast to all clients
      this.broadcast({
        type: 'message',
        data: chatMessage
      });

      logger.info('Chat message', { 
        user: chatMessage.user, 
        messageLength: sanitizedText.length 
      });
    }
  }

  checkRateLimit(clientIp) {
    const now = Date.now();
    const clientHistory = rateLimitMap.get(clientIp) || [];
    
    // Remove old entries
    const recentMessages = clientHistory.filter(
      timestamp => now - timestamp < RATE_LIMIT_WINDOW
    );

    if (recentMessages.length >= RATE_LIMIT_MAX) {
      return false;
    }

    recentMessages.push(now);
    rateLimitMap.set(clientIp, recentMessages);
    return true;
  }

  formatAddress(address) {
    if (!address) return 'Anonymous';
    return `${address.substring(0, 6)}...${address.substring(38)}`;
  }

  broadcast(data) {
    const message = JSON.stringify(data);
    this.clients.forEach(client => {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(message);
      }
    });
  }

  broadcastUserCount() {
    this.broadcast({
      type: 'userCount',
      count: this.clients.size
    });
  }
}

export default new ChatServer();
