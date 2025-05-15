// filepath: /home/jw/src/moonplace/moon-pixelmap-backend-pg/src/utils/logger.js
import winston from 'winston';
import dotenv from 'dotenv';

dotenv.config();

const { combine, timestamp, printf, errors, splat } = winston.format;

const logFormat = printf(({ level, message, timestamp, stack, service, ...metadata }) => {
  let msg = `${timestamp} [${service || 'app'}] ${level.toUpperCase()}: ${message}`;
  if (stack) {
    msg += `\n${stack}`;
  }
  // Add any additional metadata
  const meta = Object.keys(metadata).length ? JSON.stringify(metadata, null, 2) : '';
  if (meta && meta !== '{}') {
    // Avoid printing empty splat metadata like {}
    const splatSymbol = Object.getOwnPropertySymbols(metadata).find(s => s.toString() === 'Symbol(splat)');
    if (!splatSymbol || !metadata[splatSymbol] || Object.keys(metadata[splatSymbol]).length > 0) {
        msg += ` ${meta}`;
    }
  }
  return msg;
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    errors({ stack: true }),
    splat(), // Necessary for %s, %d, %j style formatting
    logFormat
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/combined.log', level: 'debug' }),
    new winston.transports.File({ filename: 'logs/errors.log', level: 'error' })
  ],
  exceptionHandlers: [
    new winston.transports.File({ filename: 'logs/exceptions.log' })
  ],
  rejectionHandlers: [
    new winston.transports.File({ filename: 'logs/rejections.log' })
  ]
});

// Helper to create a child logger with service context
export const createChildLogger = (serviceName) => {
  return logger.child({ service: serviceName });
};

export default logger;
