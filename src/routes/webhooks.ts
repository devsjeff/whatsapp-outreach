import type { FastifyInstance, FastifyRequest } from 'fastify';
import { loadEnv } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { processWhatsAppWebhook } from '../services/webhook.js';

function extractWebhookSecret(request: FastifyRequest): string | null {
  const auth = request.headers.authorization;
  if (typeof auth === 'string') {
    if (auth.toLowerCase().startsWith('bearer ')) {
      return auth.slice(7).trim();
    }
    return auth.trim();
  }

  const headerSecret = request.headers['x-webhook-secret'];
  if (typeof headerSecret === 'string') return headerSecret;
  if (Array.isArray(headerSecret)) return headerSecret[0] ?? null;

  const apikey = request.headers.apikey;
  if (typeof apikey === 'string') return apikey;

  return null;
}

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/webhooks/whatsapp', async (request, reply) => {
    const env = loadEnv();
    const provided = extractWebhookSecret(request);

    if (!provided || provided !== env.WHATSAPP_WEBHOOK_SECRET) {
      logger.warn({ ip: request.ip }, 'Rejected WhatsApp webhook — invalid secret');
      return reply.code(401).send({ error: 'unauthorized' });
    }

    try {
      const result = await processWhatsAppWebhook(request.body);
      return reply.code(200).send(result);
    } catch (error) {
      logger.error({ err: error }, 'Webhook processing failed');
      return reply.code(500).send({ error: 'webhook_processing_failed' });
    }
  });
}
