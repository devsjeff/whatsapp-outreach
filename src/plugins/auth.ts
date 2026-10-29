import fastifyBasicAuth from '@fastify/basic-auth';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { loadEnv } from '../config/env.js';

export async function registerAuth(app: FastifyInstance): Promise<void> {
  const env = loadEnv();

  await app.register(fastifyBasicAuth, {
    validate: async (username, password) => {
      if (username !== env.APP_AUTH_USERNAME || password !== env.APP_AUTH_PASSWORD) {
        throw new Error('Unauthorized');
      }
    },
    authenticate: { realm: 'Backseat Outreach' },
  });

  app.decorate(
    'authenticate',
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      await new Promise<void>((resolve, reject) => {
        app.basicAuth(request, reply, (err?: Error | null) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  );
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
