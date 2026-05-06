import winston from 'winston';
import { config } from './config';

export const logger = winston.createLogger({
  level: config.nodeEnv === 'test' ? 'silent' : 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    config.nodeEnv === 'development'
      ? winston.format.prettyPrint()
      : winston.format.json()
  ),
  defaultMeta: { service: 'payment-service' },
  transports: [new winston.transports.Console()],
});
