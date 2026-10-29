import { Telegraf } from 'telegraf';
import { loadEnv } from '../config/env.js';
import { logger } from '../lib/logger.js';

let bot: Telegraf | null = null;
let warnedMissing = false;

function getBot(): Telegraf | null {
  const env = loadEnv();
  if (!env.telegramEnabled) {
    if (!warnedMissing) {
      logger.warn(
        'Telegram notifications disabled: TELEGRAM_BOT_TOKEN and/or TELEGRAM_CHAT_ID not configured',
      );
      warnedMissing = true;
    }
    return null;
  }

  if (!bot) {
    bot = new Telegraf(env.TELEGRAM_BOT_TOKEN!);
  }
  return bot;
}

export function getTelegramStatus(): {
  configured: boolean;
  notificationsEnabled: boolean;
} {
  const env = loadEnv();
  return {
    configured: env.telegramEnabled,
    notificationsEnabled: env.telegramEnabled,
  };
}

export async function notifyAdvertiserReply(input: {
  businessName: string;
  locality: string;
  phone: string;
  message: string;
}): Promise<{ sent: boolean; reason?: string }> {
  const env = loadEnv();
  const instance = getBot();
  if (!instance || !env.TELEGRAM_CHAT_ID) {
    return { sent: false, reason: 'telegram_not_configured' };
  }

  const text = [
    'NEW ADVERTISER REPLY',
    '',
    `Business: ${input.businessName}`,
    `Area: ${input.locality}`,
    `Phone: ${input.phone}`,
    `Message: ${input.message}`,
    '',
    'Action: Contact the advertiser.',
  ].join('\n');

  try {
    await instance.telegram.sendMessage(env.TELEGRAM_CHAT_ID, text, {
      disable_notification: false,
    });
    return { sent: true };
  } catch (error) {
    logger.error({ err: error }, 'Failed to send Telegram notification');
    return { sent: false, reason: 'telegram_send_failed' };
  }
}

export async function probeTelegram(): Promise<{
  configured: boolean;
  operational: boolean;
  detail?: string;
}> {
  const env = loadEnv();
  if (!env.telegramEnabled) {
    return { configured: false, operational: false, detail: 'missing_credentials' };
  }

  try {
    const instance = getBot();
    if (!instance) {
      return { configured: false, operational: false, detail: 'missing_credentials' };
    }
    const me = await instance.telegram.getMe();
    return {
      configured: true,
      operational: Boolean(me?.id),
      detail: me?.username ? `bot:@${me.username}` : 'ok',
    };
  } catch (error) {
    logger.warn({ err: error }, 'Telegram probe failed');
    return { configured: true, operational: false, detail: 'probe_failed' };
  }
}
