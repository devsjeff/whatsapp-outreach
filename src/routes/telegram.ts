import type { FastifyInstance } from 'fastify';
import { probeTelegram } from '../services/telegram.js';

export async function telegramRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', app.basicAuth);

  app.get('/api/telegram/status', async () => {
    const probe = await probeTelegram();
    return {
      configured: probe.configured,
      operational: probe.operational,
      // Never expose bot token or chat ID
      detail: probe.detail,
      timestamp: new Date().toISOString(),
    };
  });
}
