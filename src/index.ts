import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';
import { disconnectPrisma } from './db/prisma.js';
import { logger } from './lib/logger.js';
import { disconnectRedis } from './queue/connection.js';
import { closeQueues } from './queue/queues.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const app = await buildApp();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down API');
    try {
      await app.close();
      await closeQueues();
      await disconnectRedis();
      await disconnectPrisma();
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: env.APP_PORT, host: '0.0.0.0' });
  logger.info({ port: env.APP_PORT }, 'API listening');
}

main().catch((error) => {
  logger.error({ err: error }, 'Failed to start API');
  process.exit(1);
});
