import { LeadStatus, MessageDeliveryStatus, MessageDirection, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { loadEnv } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { logger } from '../lib/logger.js';
import { phoneFromWhatsAppJid } from '../lib/phone.js';
import { notifyAdvertiserReply } from './telegram.js';

type IncomingMessage = {
  key?: {
    remoteJid?: string;
    fromMe?: boolean;
    id?: string;
    participant?: string;
  };
  pushName?: string;
  message?: Record<string, unknown>;
  messageType?: string;
  messageTimestamp?: number | string;
};

function stableEventKey(payload: unknown): string {
  const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return hash;
}

function extractText(message: IncomingMessage): string | null {
  const m = message.message;
  if (!m) return null;

  if (typeof m.conversation === 'string') return m.conversation;
  const extended = m.extendedTextMessage as { text?: string } | undefined;
  if (extended?.text) return extended.text;
  const image = m.imageMessage as { caption?: string } | undefined;
  if (image?.caption) return image.caption;
  const video = m.videoMessage as { caption?: string } | undefined;
  if (video?.caption) return video.caption;
  const buttons = m.buttonsResponseMessage as { selectedDisplayText?: string } | undefined;
  if (buttons?.selectedDisplayText) return buttons.selectedDisplayText;
  const list = m.listResponseMessage as { title?: string } | undefined;
  if (list?.title) return list.title;

  return null;
}

function isOptOut(text: string): { matched: boolean; keyword?: string } {
  const env = loadEnv();
  const normalized = text.trim().toUpperCase();
  for (const keyword of env.optOutKeywords) {
    if (normalized === keyword || normalized.startsWith(`${keyword} `)) {
      return { matched: true, keyword };
    }
  }
  return { matched: false };
}

function unwrapMessages(payload: Record<string, unknown>): IncomingMessage[] {
  const data = payload.data ?? payload;
  if (!data || typeof data !== 'object') return [];

  const obj = data as Record<string, unknown>;
  if (Array.isArray(obj.messages)) {
    return obj.messages as IncomingMessage[];
  }
  // Evolution often sends a single message object under data
  if (obj.key || obj.message) {
    return [obj as IncomingMessage];
  }
  return [];
}

export async function processWhatsAppWebhook(payload: unknown): Promise<{
  accepted: boolean;
  duplicate?: boolean;
  processed: number;
}> {
  if (!payload || typeof payload !== 'object') {
    return { accepted: false, processed: 0 };
  }

  const body = payload as Record<string, unknown>;
  const eventType = String(body.event ?? body.type ?? 'unknown');
  const instanceName =
    typeof body.instance === 'string'
      ? body.instance
      : ((body.instance as { instanceName?: string } | undefined)?.instanceName ?? null);

  const eventKey = (() => {
    const messages = unwrapMessages(body);
    const ids = messages
      .map((m) => m.key?.id)
      .filter(Boolean)
      .join(':');
    if (ids) return `${eventType}:${instanceName ?? 'na'}:${ids}`;
    return `${eventType}:${instanceName ?? 'na'}:${stableEventKey(payload)}`;
  })();

  try {
    await prisma.webhookEvent.create({
      data: {
        eventKey,
        eventType,
        instanceName,
        payload: body as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { accepted: true, duplicate: true, processed: 0 };
    }
    throw error;
  }

  let processed = 0;

  if (eventType.toLowerCase().includes('messages.upsert') || eventType === 'MESSAGES_UPSERT') {
    const messages = unwrapMessages(body);
    for (const message of messages) {
      const handled = await handleIncomingMessage(message);
      if (handled) processed += 1;
    }
  }

  await prisma.webhookEvent.update({
    where: { eventKey },
    data: { processedAt: new Date() },
  });

  return { accepted: true, processed };
}

async function handleIncomingMessage(message: IncomingMessage): Promise<boolean> {
  if (message.key?.fromMe) {
    return false;
  }

  const remoteJid = message.key?.remoteJid ?? '';
  if (remoteJid.endsWith('@g.us')) {
    // Ignore group messages
    return false;
  }

  const phone = phoneFromWhatsAppJid(remoteJid);
  if (!phone) {
    logger.warn({ remoteJid }, 'Could not extract phone from inbound WhatsApp message');
    return false;
  }

  const text = extractText(message) ?? '';
  const lead = await prisma.lead.findUnique({ where: { phoneNormalized: phone } });
  if (!lead) {
    logger.info({ phone }, 'Inbound WhatsApp message from unknown number — ignored');
    return false;
  }

  const optOut = text ? isOptOut(text) : { matched: false };

  await prisma.$transaction(async (tx) => {
    await tx.messageLog.create({
      data: {
        leadId: lead.id,
        campaignId: lead.lastCampaignId,
        direction: MessageDirection.INBOUND,
        body: text || '[non-text message]',
        deliveryStatus: MessageDeliveryStatus.DELIVERED,
        providerMessageId: message.key?.id ?? null,
        providerRaw: message as unknown as Prisma.InputJsonValue,
      },
    });

    if (optOut.matched) {
      await tx.lead.update({
        where: { id: lead.id },
        data: {
          status: LeadStatus.OPTED_OUT,
          optedOutAt: lead.optedOutAt ?? new Date(),
          lastRepliedAt: new Date(),
        },
      });
      await tx.optOutEvent.create({
        data: {
          leadId: lead.id,
          source: 'whatsapp_reply',
          keyword: optOut.keyword ?? null,
          rawText: text,
        },
      });
    } else if (lead.status !== LeadStatus.OPTED_OUT) {
      await tx.lead.update({
        where: { id: lead.id },
        data: {
          status: LeadStatus.REPLIED,
          lastRepliedAt: new Date(),
        },
      });
    }
  });

  // Outside transaction: notify sales (never auto-reply to advertiser)
  if (!optOut.matched) {
    await notifyAdvertiserReply({
      businessName: lead.businessName,
      locality: lead.locality,
      phone: lead.phoneNormalized,
      message: text || '[non-text message]',
    });
  } else {
    // Still notify sales about opt-out replies for visibility
    await notifyAdvertiserReply({
      businessName: lead.businessName,
      locality: lead.locality,
      phone: lead.phoneNormalized,
      message: `[OPT-OUT] ${text}`,
    });
  }

  return true;
}
