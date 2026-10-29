import { z } from 'zod';

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  LOG_LEVEL: z.string().default('info'),
  APP_PORT: z.coerce.number().int().positive().default(3000),
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),
  APP_AUTH_USERNAME: z.string().min(1),
  APP_AUTH_PASSWORD: z.string().min(8),
  // Comma-separated browser origins allowed to call the API (CORS). Use * only for temporary demos.
  CORS_ORIGIN: z.string().default('*'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  EVOLUTION_API_URL: z.string().url(),
  EVOLUTION_API_KEY: z.string().min(16),
  EVOLUTION_INSTANCE_NAME: z.string().min(1).default('backseat-outreach'),
  WHATSAPP_WEBHOOK_SECRET: z.string().min(8),
  TELEGRAM_BOT_TOKEN: optionalString,
  TELEGRAM_CHAT_ID: optionalString,
  // Gemini (optional). When unset or GEMINI_MESSAGE_GENERATION=false, static templates are used.
  GEMINI_API_KEY: optionalString,
  GEMINI_MODEL: z.string().min(1).default('gemini-flash-latest'),
  GEMINI_MESSAGE_GENERATION: z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v.trim() === '') return false;
      return ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());
    }),
  // Deprecated placeholders — ignored; prefer GEMINI_*
  OPENROUTER_API_KEY: optionalString,
  OPENROUTER_MODEL: optionalString,
  TIMEZONE: z.string().default('Asia/Kolkata'),
  // Founder guidance: keep cold outreach under ~30–50/day and sleep 30–60s between sends.
  DAILY_MESSAGE_LIMIT: z.coerce.number().int().positive().default(35),
  MIN_MESSAGE_DELAY_SECONDS: z.coerce.number().int().positive().default(30),
  MAX_MESSAGE_DELAY_SECONDS: z.coerce.number().int().positive().default(60),
  SENDING_WINDOW_START: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .default('10:00'),
  SENDING_WINDOW_END: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .default('18:30'),
  SENDING_DAYS: z.string().default('1,2,3,4,5,6'),
  OPT_OUT_KEYWORDS: z.string().default('STOP,UNSUBSCRIBE'),
  MESSAGE_TEMPLATE: z
    .string()
    .min(1)
    .default(
      'Hi {{contact_person_or_business_name}} team, we came across your business in {{locality}}.\n\nBackseat Network offers in-cab advertising opportunities across Delhi NCR. Would you be interested in learning more?\n\nReply STOP if you do not wish to receive further messages.',
    ),
  DEFAULT_PHONE_COUNTRY: z.string().length(2).default('IN'),
});

export type Env = z.infer<typeof envSchema> & {
  sendingDays: number[];
  optOutKeywords: string[];
  telegramEnabled: boolean;
  geminiEnabled: boolean;
};

let cached: Env | null = null;

function parseSendingDays(raw: string): number[] {
  return raw
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
}

export function loadEnv(env: NodeJS.ProcessEnv = process.env): Env {
  if (cached && env === process.env) {
    return cached;
  }

  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid configuration: ${details}`);
  }

  const data = parsed.data;
  if (data.MAX_MESSAGE_DELAY_SECONDS < data.MIN_MESSAGE_DELAY_SECONDS) {
    throw new Error(
      'Invalid configuration: MAX_MESSAGE_DELAY_SECONDS must be >= MIN_MESSAGE_DELAY_SECONDS',
    );
  }
  const sendingDays = parseSendingDays(data.SENDING_DAYS);
  if (sendingDays.length === 0) {
    throw new Error('Invalid configuration: SENDING_DAYS must include at least one weekday (0-6)');
  }

  const result: Env = {
    ...data,
    sendingDays,
    optOutKeywords: data.OPT_OUT_KEYWORDS.split(',')
      .map((k) => k.trim().toUpperCase())
      .filter(Boolean),
    telegramEnabled: Boolean(data.TELEGRAM_BOT_TOKEN && data.TELEGRAM_CHAT_ID),
    geminiEnabled: Boolean(data.GEMINI_API_KEY && data.GEMINI_MESSAGE_GENERATION),
  };

  if (env === process.env) {
    cached = result;
  }

  return result;
}

export function resetEnvCache(): void {
  cached = null;
}
