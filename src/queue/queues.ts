import { Queue, type ConnectionOptions } from 'bullmq';
import { getRedis } from './connection.js';

export const OUTREACH_QUEUE_NAME = 'outreach-send';

export type OutreachJobData = {
  campaignId: string;
  campaignLeadId: string;
  leadId: string;
};

function connectionOptions(): ConnectionOptions {
  return getRedis() as unknown as ConnectionOptions;
}

let outreachQueue: Queue<OutreachJobData> | null = null;

export function getOutreachQueue(): Queue<OutreachJobData> {
  if (!outreachQueue) {
    outreachQueue = new Queue<OutreachJobData>(OUTREACH_QUEUE_NAME, {
      connection: connectionOptions(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    });
  }
  return outreachQueue;
}

export async function closeQueues(): Promise<void> {
  if (outreachQueue) {
    await outreachQueue.close();
    outreachQueue = null;
  }
}
