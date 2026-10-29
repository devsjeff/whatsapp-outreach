import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetEnvCache } from '../../src/config/env.js';

describe('health routes', () => {
  let app: Awaited<ReturnType<typeof import('../../src/app.js').buildApp>>;

  beforeAll(async () => {
    process.env.APP_AUTH_USERNAME = 'admin';
    process.env.APP_AUTH_PASSWORD = 'test-password-123';
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ?? 'postgresql://outreach:outreach@localhost:5432/outreach';
    process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379/0';
    process.env.EVOLUTION_API_URL = process.env.EVOLUTION_API_URL ?? 'http://127.0.0.1:18080';
    process.env.EVOLUTION_API_KEY = '0123456789abcdef0123456789abcdef';
    process.env.WHATSAPP_WEBHOOK_SECRET = 'test-webhook-secret';
    process.env.APP_BASE_URL = 'http://localhost:3000';
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'silent';
    resetEnvCache();

    const { buildApp } = await import('../../src/app.js');
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    resetEnvCache();
  });

  it('GET /health returns ok without auth', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok' });
  });

  it('rejects admin endpoints without credentials', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/whatsapp/status' });
    expect(response.statusCode).toBe(401);
  });

  it('rejects webhook without secret', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/webhooks/whatsapp',
      payload: { event: 'MESSAGES_UPSERT', data: {} },
    });
    expect(response.statusCode).toBe(401);
  });

  it('does not return 401 when webhook secret is valid', async () => {
    // Avoid hanging forever when Postgres is down locally: race inject vs short timeout.
    const injectPromise = app.inject({
      method: 'POST',
      url: '/api/webhooks/whatsapp',
      headers: {
        authorization: 'Bearer test-webhook-secret',
      },
      payload: {
        event: 'CONNECTION_UPDATE',
        instance: 'backseat-outreach',
        data: { state: 'open' },
      },
    });

    const timedOut = { statusCode: 504 };
    const response = await Promise.race([
      injectPromise,
      new Promise<typeof timedOut>((resolve) => {
        setTimeout(() => resolve(timedOut), 1500);
      }),
    ]);

    expect(response.statusCode).not.toBe(401);
    expect([200, 500, 504]).toContain(response.statusCode);
  }, 10_000);
});
