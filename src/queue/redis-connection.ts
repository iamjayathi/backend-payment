import IORedis from 'ioredis';
import { config } from '../config';

export function createRedisConnection() {
  const url = new URL(config.redisUrl);
  return new IORedis({
    host: url.hostname,
    port: parseInt(url.port || '6379', 10),
    password: url.password || undefined,
    maxRetriesPerRequest: null,
  });
}
