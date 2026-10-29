import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { loadEnv } from '../config/env.js';
import { composeOutreachMessage, generateContent, getGeminiStatus } from '../services/gemini.js';

const previewSchema = z.object({
  businessName: z.string().min(1),
  contactPerson: z.string().optional().nullable(),
  locality: z.string().min(1),
  category: z.string().optional().nullable(),
  messageTemplate: z.string().optional(),
});

export async function geminiRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', app.basicAuth);

  app.get('/api/gemini/status', async () => {
    const status = getGeminiStatus();
    return {
      ...status,
      // Never return the API key
      timestamp: new Date().toISOString(),
    };
  });

  app.post('/api/gemini/preview', async (request, reply) => {
    const parsed = previewSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation_error', details: parsed.error.flatten() });
    }

    const env = loadEnv();
    if (!env.GEMINI_API_KEY) {
      return reply.code(503).send({
        error: 'gemini_not_configured',
        message: 'Set GEMINI_API_KEY in .env to use Gemini preview',
      });
    }

    const template = parsed.data.messageTemplate ?? env.MESSAGE_TEMPLATE;
    const composed = await composeOutreachMessage(
      {
        business_name: parsed.data.businessName,
        contact_person: parsed.data.contactPerson,
        locality: parsed.data.locality,
        category: parsed.data.category,
      },
      template,
    );

    return {
      source: composed.source,
      message: composed.body,
      model: env.GEMINI_MODEL,
    };
  });

  app.post('/api/gemini/raw', async (request, reply) => {
    const body = request.body as { prompt?: string };
    if (!body?.prompt?.trim()) {
      return reply.code(400).send({ error: 'prompt is required' });
    }
    const env = loadEnv();
    if (!env.GEMINI_API_KEY) {
      return reply.code(503).send({ error: 'gemini_not_configured' });
    }
    try {
      const text = await generateContent(body.prompt.trim());
      return { model: env.GEMINI_MODEL, text };
    } catch (error) {
      return reply.code(502).send({
        error: 'gemini_request_failed',
        message: error instanceof Error ? error.message : 'unknown_error',
      });
    }
  });
}
