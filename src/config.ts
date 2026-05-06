import { loadEnv } from './env';

loadEnv();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/payments_db',

  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',

  payment: {
    maxRetries: parseInt(process.env.MAX_RETRIES || '3', 10),
    retryDelayBaseMs: parseInt(process.env.RETRY_DELAY_BASE_MS || '1000', 10),
  },

  webhookSecret: process.env.WEBHOOK_SECRET || 'dev-webhook-secret',
};
