import type { FastifyInstance } from 'fastify';
import { checkDatabase } from '../db/prisma.js';
import { checkRedis } from '../queue/connection.js';
import { checkEvolutionHealth } from '../services/evolution.js';
import { getTelegramStatus } from '../services/telegram.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({
    status: 'ok',
    service: 'backseat-whatsapp-outreach',
    timestamp: new Date().toISOString(),
  }));

  app.get('/api/health/ready', async (_request, reply) => {
    const [database, redis, evolution] = await Promise.all([
      checkDatabase(),
      checkRedis(),
      checkEvolutionHealth(),
    ]);

    const telegram = getTelegramStatus();
    const ready = database && redis;

    return reply.code(ready ? 200 : 503).send({
      status: ready ? 'ready' : 'not_ready',
      checks: {
        database,
        redis,
        evolution,
        telegramConfigured: telegram.configured,
      },
      timestamp: new Date().toISOString(),
    });
  });
}
