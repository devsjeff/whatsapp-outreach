import { afterEach, describe, expect, it } from 'vitest';
import { loadEnv, resetEnvCache } from '../../src/config/env.js';

const baseEnv = {
  APP_AUTH_USERNAME: 'admin',
  APP_AUTH_PASSWORD: 'super-secret',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/outreach',
  REDIS_URL: 'redis://localhost:6379/0',
  EVOLUTION_API_URL: 'http://evolution-api:8080',
  EVOLUTION_API_KEY: '0123456789abcdef',
  WHATSAPP_WEBHOOK_SECRET: 'webhook-secret',
  APP_BASE_URL: 'http://localhost:3000',
};

describe('loadEnv', () => {
  afterEach(() => {
    resetEnvCache();
  });

  it('loads defaults and derived fields', () => {
    const env = loadEnv({ ...baseEnv } as NodeJS.ProcessEnv);
    expect(env.APP_PORT).toBe(3000);
    expect(env.TIMEZONE).toBe('Asia/Kolkata');
    expect(env.DAILY_MESSAGE_LIMIT).toBe(35);
    expect(env.MIN_MESSAGE_DELAY_SECONDS).toBe(30);
    expect(env.MAX_MESSAGE_DELAY_SECONDS).toBe(60);
    expect(env.sendingDays).toEqual([1, 2, 3, 4, 5, 6]);
    expect(env.optOutKeywords).toContain('STOP');
    expect(env.telegramEnabled).toBe(false);
  });

  it('enables telegram when both credentials exist', () => {
    const env = loadEnv({
      ...baseEnv,
      TELEGRAM_BOT_TOKEN: '123:abc',
      TELEGRAM_CHAT_ID: '-1001',
    } as NodeJS.ProcessEnv);
    expect(env.telegramEnabled).toBe(true);
  });

  it('rejects short auth password', () => {
    expect(() =>
      loadEnv({
        ...baseEnv,
        APP_AUTH_PASSWORD: 'short',
      } as NodeJS.ProcessEnv),
    ).toThrow(/Invalid configuration/);
  });
});
