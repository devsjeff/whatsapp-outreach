import type { FastifyInstance } from 'fastify';
import {
  connectInstance,
  disconnectInstance,
  EvolutionApiError,
  getConnectionState,
  getQrCode,
} from '../services/evolution.js';

export async function whatsappRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', app.basicAuth);

  app.get('/api/whatsapp/status', async (_request, reply) => {
    try {
      const result = await getConnectionState();
      return {
        instanceConnected: result.state === 'open',
        state: result.state,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return mapEvolutionError(reply, error);
    }
  });

  app.post('/api/whatsapp/connect', async (_request, reply) => {
    try {
      const result = await connectInstance();
      return {
        created: result.created,
        state: result.state,
        qr: {
          available: Boolean(result.qr.base64),
          base64: result.qr.base64,
          pairingCode: result.qr.pairingCode,
        },
        message:
          result.state === 'open'
            ? 'WhatsApp already connected'
            : 'Scan the QR code from GET /api/whatsapp/qr',
      };
    } catch (error) {
      return mapEvolutionError(reply, error);
    }
  });

  app.get('/api/whatsapp/qr', async (_request, reply) => {
    try {
      const result = await getQrCode();
      if (result.state === 'open') {
        return {
          state: result.state,
          qr: null,
          message: 'WhatsApp is already connected',
        };
      }
      if (!result.base64 && !result.pairingCode) {
        return reply.code(503).send({
          error: 'qr_unavailable',
          message: 'Evolution API did not return a QR code. Call POST /api/whatsapp/connect first.',
          state: result.state,
        });
      }
      return {
        state: result.state,
        qr: {
          base64: result.base64,
          pairingCode: result.pairingCode,
          mimeType: result.base64?.startsWith('data:image/')
            ? result.base64.slice(5, result.base64.indexOf(';'))
            : 'image/png',
        },
      };
    } catch (error) {
      return mapEvolutionError(reply, error);
    }
  });

  app.post('/api/whatsapp/disconnect', async (_request, reply) => {
    try {
      const raw = await disconnectInstance();
      return {
        disconnected: true,
        result: raw,
      };
    } catch (error) {
      return mapEvolutionError(reply, error);
    }
  });
}

function mapEvolutionError(reply: import('fastify').FastifyReply, error: unknown) {
  if (error instanceof EvolutionApiError) {
    return reply.code(502).send({
      error: 'evolution_api_error',
      message: error.message,
      status: error.status,
    });
  }
  throw error;
}
