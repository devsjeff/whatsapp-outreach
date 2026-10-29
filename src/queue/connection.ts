import { Redis } from 'ioredis';
import { loadEnv } from '../config/env.js';
import { logger } from '../lib/logger.js';

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (redis) return redis;

  const env = loadEnv();
  redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });

  redis.on('error', (err: Error) => {
    logger.error({ err }, 'Redis connection error');
  });

  return redis;
}

export async function checkRedis(): Promise<boolean> {
  try {
    const result = await getRedis().ping();
    return result === 'PONG';
  } catch (error) {
    logger.error({ err: error }, 'Redis health check failed');
    return false;
  }
}

export async function disconnectRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}
