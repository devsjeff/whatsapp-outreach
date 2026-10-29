import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCache } from '../../src/config/env.js';
import { composeOutreachMessage } from '../../src/services/gemini.js';

function setEnv(overrides: Record<string, string>): void {
  for (const [key, value] of Object.entries(overrides)) {
    process.env[key] = value;
  }
  resetEnvCache();
}

describe('gemini composeOutreachMessage', () => {
  beforeEach(() => {
    setEnv({
      APP_AUTH_USERNAME: 'admin',
      APP_AUTH_PASSWORD: 'super-secret',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/outreach',
      REDIS_URL: 'redis://localhost:6379/0',
      EVOLUTION_API_URL: 'http://evolution-api:8080',
      EVOLUTION_API_KEY: '0123456789abcdef',
      WHATSAPP_WEBHOOK_SECRET: 'webhook-secret',
      APP_BASE_URL: 'http://localhost:3000',
      GEMINI_API_KEY: '',
      GEMINI_MESSAGE_GENERATION: 'false',
      GEMINI_MODEL: 'gemini-flash-latest',
    });
  });

  afterEach(() => {
    resetEnvCache();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_MESSAGE_GENERATION;
  });

  it('uses template when Gemini generation is disabled', async () => {
    setEnv({
      GEMINI_API_KEY: 'test-key-not-used',
      GEMINI_MESSAGE_GENERATION: 'false',
    });

    const result = await composeOutreachMessage(
      {
        business_name: 'Acme',
        contact_person: 'Riya',
        locality: 'Saket',
      },
      'Hi {{contact_person_or_business_name}} in {{locality}}',
    );

    expect(result.source).toBe('template');
    expect(result.body).toBe('Hi Riya in Saket');
  });

  it('uses Gemini text when enabled', async () => {
    setEnv({
      GEMINI_API_KEY: 'test-key',
      GEMINI_MESSAGE_GENERATION: 'true',
      GEMINI_MODEL: 'gemini-flash-latest',
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: 'Hi Riya team in Saket — interested in in-cab ads?\n\nReply STOP if you do not wish to receive further messages.',
                  },
                ],
              },
            },
          ],
        }),
      }),
    );

    const result = await composeOutreachMessage(
      {
        business_name: 'Acme',
        contact_person: 'Riya',
        locality: 'Saket',
      },
      'Hi {{contact_person_or_business_name}} in {{locality}}',
    );

    expect(result.source).toBe('gemini');
    expect(result.body).toContain('Saket');
    expect(result.body.toUpperCase()).toContain('STOP');
  });

  it('falls back to template when Gemini request fails', async () => {
    setEnv({
      GEMINI_API_KEY: 'test-key',
      GEMINI_MESSAGE_GENERATION: 'true',
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: { message: 'quota exceeded' } }),
      }),
    );

    const result = await composeOutreachMessage(
      {
        business_name: 'Acme',
        contact_person: 'Riya',
        locality: 'Saket',
      },
      'Hi {{contact_person_or_business_name}} in {{locality}}',
    );

    expect(result.source).toBe('template');
    expect(result.body).toBe('Hi Riya in Saket');
  });
});
