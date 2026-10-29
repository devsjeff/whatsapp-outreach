import { pino, type Logger } from 'pino';
import { loadEnv } from '../config/env.js';

const SECRET_KEYS = [
  'password',
  'token',
  'apikey',
  'api_key',
  'authorization',
  'secret',
  'DATABASE_URL',
  'REDIS_URL',
  'EVOLUTION_API_KEY',
  'TELEGRAM_BOT_TOKEN',
  'WHATSAPP_WEBHOOK_SECRET',
  'APP_AUTH_PASSWORD',
  'OPENROUTER_API_KEY',
  'GEMINI_API_KEY',
];

function redactPaths(): string[] {
  return SECRET_KEYS.flatMap((key) => [
    key,
    `*.${key}`,
    `*.${key.toLowerCase()}`,
    `req.headers.${key.toLowerCase()}`,
  ]);
}

export function createLogger(name?: string): Logger {
  const env = (() => {
    try {
      return loadEnv();
    } catch {
      return {
        NODE_ENV: process.env.NODE_ENV ?? 'production',
        LOG_LEVEL: process.env.LOG_LEVEL ?? 'info',
      };
    }
  })();

  return pino({
    name,
    level: env.LOG_LEVEL,
    redact: {
      paths: redactPaths(),
      censor: '[REDACTED]',
    },
    transport:
      env.NODE_ENV === 'development'
        ? {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:standard' },
          }
        : undefined,
  });
}

export const logger = createLogger('app');
