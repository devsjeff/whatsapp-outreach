import { DelayedError, Worker, type ConnectionOptions } from 'bullmq';
import { loadEnv } from './config/env.js';
import { disconnectPrisma } from './db/prisma.js';
import { logger } from './lib/logger.js';
import { getRedis, disconnectRedis } from './queue/connection.js';
import {
  DelayedSendError,
  processSendMessageJob,
} from './queue/processors/send-message.js';
import { OUTREACH_QUEUE_NAME, closeQueues, type OutreachJobData } from './queue/queues.js';

async function main(): Promise<void> {
  loadEnv();
  logger.info('Starting outreach worker');

  const worker = new Worker<OutreachJobData>(
    OUTREACH_QUEUE_NAME,
    async (job, token) => {
      try {
        await processSendMessageJob(job);
      } catch (error) {
        if (error instanceof DelayedSendError) {
          logger.info(
            { jobId: job.id, delayMs: error.delayMs, reason: error.message },
            'Job delayed',
          );
          await job.moveToDelayed(Date.now() + error.delayMs, token);
          throw new DelayedError();
        }
        throw error;
      }
    },
    {
      connection: getRedis() as unknown as ConnectionOptions,
      concurrency: 1,
      limiter: {
        max: 1,
        duration: 1000,
      },
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Outreach job failed');
  });

  worker.on('completed', (job) => {
    logger.debug({ jobId: job.id }, 'Outreach job completed');
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down worker');
    await worker.close();
    await closeQueues();
    await disconnectRedis();
    await disconnectPrisma();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  logger.error({ err: error }, 'Failed to start worker');
  process.exit(1);
});
