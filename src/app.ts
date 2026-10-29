import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { loadEnv } from './config/env.js';
import { logger } from './lib/logger.js';
import { registerAuth } from './plugins/auth.js';
import { geminiRoutes } from './routes/gemini.js';
import { healthRoutes } from './routes/health.js';
import { leadRoutes } from './routes/leads.js';
import { outreachRoutes } from './routes/outreach.js';
import { telegramRoutes } from './routes/telegram.js';
import { webhookRoutes } from './routes/webhooks.js';
import { whatsappRoutes } from './routes/whatsapp.js';

export async function buildApp(): Promise<FastifyInstance> {
  const env = loadEnv();
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: {
        paths: [
          'password',
          'token',
          'apikey',
          'authorization',
          'req.headers.authorization',
          'req.headers.apikey',
        ],
        censor: '[REDACTED]',
      },
    },
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: true,
    genReqId: () => randomUUID(),
  });

  const corsOrigin =
    env.CORS_ORIGIN.trim() === '*'
      ? true
      : env.CORS_ORIGIN.split(',')
          .map((o) => o.trim())
          .filter(Boolean);

  await app.register(cors, {
    origin: corsOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  });

  await app.register(multipart, {
    limits: {
      fileSize: 5 * 1024 * 1024,
      files: 1,
    },
  });

  await registerAuth(app);

  await app.register(healthRoutes);
  await app.register(webhookRoutes);
  await app.register(whatsappRoutes);
  await app.register(leadRoutes);
  await app.register(outreachRoutes);
  await app.register(telegramRoutes);
  await app.register(geminiRoutes);

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'Unhandled error');
    const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
    if (statusCode >= 500) {
      return reply.code(statusCode).send({
        error: 'internal_error',
        message: 'An unexpected error occurred',
      });
    }
    return reply.code(statusCode).send({
      error: (error as Error).name || 'request_error',
      message: (error as Error).message,
    });
  });

  app.addHook('onReady', async () => {
    logger.info(
      {
        port: env.APP_PORT,
        timezone: env.TIMEZONE,
        telegramEnabled: env.telegramEnabled,
        geminiEnabled: env.geminiEnabled,
        geminiModel: env.GEMINI_MODEL,
      },
      'Application ready',
    );
  });

  return app;
}
