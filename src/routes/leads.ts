import { LeadStatus } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createLead,
  getLead,
  getLeadMessages,
  importLeadsFromCsv,
  listLeads,
  optOutLead,
  updateLead,
} from '../services/leads.js';

const createLeadSchema = z.object({
  businessName: z.string().min(1),
  contactPerson: z.string().optional().nullable(),
  phone: z.string().min(5),
  locality: z.string().min(1),
  category: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const updateLeadSchema = createLeadSchema.partial().extend({
  status: z.nativeEnum(LeadStatus).optional(),
});

export async function leadRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', app.basicAuth);

  app.post('/api/leads/import', async (request, reply) => {
    const file = await request.file();
    if (!file) {
      return reply.code(400).send({
        error: 'missing_file',
        message: 'Upload a CSV file under field name "file"',
      });
    }

    const buffer = await file.toBuffer();
    try {
      const summary = await importLeadsFromCsv(buffer);
      return {
        message: 'CSV processed. No messages were sent.',
        summary,
      };
    } catch (error) {
      return mapServiceError(reply, error);
    }
  });

  app.post('/api/leads', async (request, reply) => {
    const parsed = createLeadSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation_error', details: parsed.error.flatten() });
    }
    try {
      const lead = await createLead(parsed.data);
      return reply.code(201).send({ lead });
    } catch (error) {
      return mapServiceError(reply, error);
    }
  });

  app.get('/api/leads', async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const status = query.status as LeadStatus | undefined;
    if (status && !Object.values(LeadStatus).includes(status)) {
      return reply.code(400).send({ error: 'invalid_status' });
    }
    const result = await listLeads({
      page: query.page ? Number(query.page) : 1,
      pageSize: query.pageSize ? Number(query.pageSize) : 20,
      status,
      search: query.search,
    });
    return result;
  });

  app.get('/api/leads/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const lead = await getLead(id);
      return { lead };
    } catch (error) {
      return mapServiceError(reply, error);
    }
  });

  app.patch('/api/leads/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateLeadSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation_error', details: parsed.error.flatten() });
    }
    try {
      const lead = await updateLead(id, parsed.data);
      return { lead };
    } catch (error) {
      return mapServiceError(reply, error);
    }
  });

  app.get('/api/leads/:id/messages', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as Record<string, string | undefined>;
    try {
      const result = await getLeadMessages(
        id,
        query.page ? Number(query.page) : 1,
        query.pageSize ? Number(query.pageSize) : 50,
      );
      return result;
    } catch (error) {
      return mapServiceError(reply, error);
    }
  });

  app.post('/api/leads/:id/opt-out', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const lead = await optOutLead(id, 'manual_api');
      return { lead, message: 'Lead opted out; future outreach blocked' };
    } catch (error) {
      return mapServiceError(reply, error);
    }
  });
}

function mapServiceError(reply: import('fastify').FastifyReply, error: unknown) {
  const err = error as { statusCode?: number; message?: string; leadId?: string };
  if (err.statusCode) {
    return reply.code(err.statusCode).send({
      error: err.message ?? 'request_failed',
      leadId: err.leadId,
    });
  }
  throw error;
}
