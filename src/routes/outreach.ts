import { LeadStatus } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  getCampaign,
  getOutreachStats,
  listCampaigns,
  pauseOutreach,
  resumeOutreach,
  startOutreach,
} from '../services/outreach.js';

const startSchema = z.object({
  name: z.string().min(1).optional(),
  leadIds: z.array(z.string().min(1)).optional(),
  statuses: z.array(z.nativeEnum(LeadStatus)).optional(),
  messageTemplate: z.string().min(1).optional(),
  dailyLimit: z.number().int().positive().optional(),
  minDelaySeconds: z.number().int().positive().optional(),
  confirm: z.literal(true),
});

export async function outreachRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', app.basicAuth);

  app.post('/api/outreach/start', async (request, reply) => {
    const parsed = startSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'validation_error',
        message: 'Body must include confirm: true and valid campaign settings',
        details: parsed.error.flatten(),
      });
    }

    try {
      const { confirm: _confirm, ...input } = parsed.data;
      const result = await startOutreach(input);
      return reply.code(201).send({
        message: 'Campaign started; eligible leads enqueued. Messages send via worker.',
        ...result,
      });
    } catch (error) {
      return mapServiceError(reply, error);
    }
  });

  app.post('/api/outreach/pause', async () => {
    const result = await pauseOutreach();
    return { message: 'Outreach paused', ...result };
  });

  app.post('/api/outreach/resume', async () => {
    const result = await resumeOutreach();
    return { message: 'Outreach resumed', ...result };
  });

  app.get('/api/outreach/stats', async () => getOutreachStats());

  app.get('/api/outreach/campaigns', async (request) => {
    const query = request.query as Record<string, string | undefined>;
    return listCampaigns(
      query.page ? Number(query.page) : 1,
      query.pageSize ? Number(query.pageSize) : 20,
    );
  });

  app.get('/api/outreach/campaigns/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const campaign = await getCampaign(id);
      return { campaign };
    } catch (error) {
      return mapServiceError(reply, error);
    }
  });
}

function mapServiceError(reply: import('fastify').FastifyReply, error: unknown) {
  const err = error as { statusCode?: number; message?: string };
  if (err.statusCode) {
    return reply.code(err.statusCode).send({ error: err.message ?? 'request_failed' });
  }
  throw error;
}
