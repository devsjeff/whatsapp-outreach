import {
  CampaignStatus,
  LeadStatus,
  MessageDeliveryStatus,
  MessageDirection,
  Prisma,
} from '@prisma/client';
import type { Job } from 'bullmq';
import { loadEnv } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { logger } from '../../lib/logger.js';
import { validateTemplateFields } from '../../lib/template.js';
import { isWithinSendingWindow, msUntilNextSendingWindow } from '../../lib/time-window.js';
import { EvolutionApiError, getConnectionState, sendTextMessage } from '../../services/evolution.js';
import { composeOutreachMessage } from '../../services/gemini.js';
import {
  releaseSendSlot,
  tryReserveSendSlot,
} from '../../services/rate-limit.js';
import type { OutreachJobData } from '../queues.js';

export class DelayedSendError extends Error {
  constructor(
    message: string,
    readonly delayMs: number,
  ) {
    super(message);
    this.name = 'DelayedSendError';
  }
}

export async function processSendMessageJob(job: Job<OutreachJobData>): Promise<void> {
  const env = loadEnv();
  const { campaignId, campaignLeadId, leadId } = job.data;

  const [campaign, lead, campaignLead] = await Promise.all([
    prisma.campaign.findUnique({ where: { id: campaignId } }),
    prisma.lead.findUnique({ where: { id: leadId } }),
    prisma.campaignLead.findUnique({ where: { id: campaignLeadId } }),
  ]);

  if (!campaign || !lead || !campaignLead) {
    logger.warn({ campaignId, leadId, campaignLeadId }, 'Skipping job — missing entities');
    return;
  }

  if (campaign.status === CampaignStatus.PAUSED || campaign.status === CampaignStatus.CANCELLED) {
    throw new DelayedSendError('Campaign paused or cancelled', 60_000);
  }

  if (lead.status === LeadStatus.OPTED_OUT) {
    await prisma.campaignLead.update({
      where: { id: campaignLeadId },
      data: { status: LeadStatus.OPTED_OUT },
    });
    return;
  }

  if (lead.status === LeadStatus.SENT || lead.status === LeadStatus.REPLIED) {
    // Already contacted — skip duplicate send
    return;
  }

  const window = {
    timezone: env.TIMEZONE,
    start: env.SENDING_WINDOW_START,
    end: env.SENDING_WINDOW_END,
    days: env.sendingDays,
  };

  const now = new Date();
  if (!isWithinSendingWindow(now, window)) {
    const wait = msUntilNextSendingWindow(now, window);
    throw new DelayedSendError('Outside sending window', Math.max(wait, 30_000));
  }

  const { state } = await getConnectionState();
  if (state !== 'open') {
    throw new DelayedSendError(`WhatsApp not connected (state=${state})`, 60_000);
  }

  const fieldErrors = validateTemplateFields({
    business_name: lead.businessName,
    contact_person: lead.contactPerson,
    locality: lead.locality,
    category: lead.category,
    phone: lead.phoneNormalized,
  });
  if (fieldErrors.length > 0) {
    await markFailed(campaignLeadId, leadId, fieldErrors.join('; '));
    return;
  }

  let body: string;
  let messageSource: 'gemini' | 'template' = 'template';
  try {
    const composed = await composeOutreachMessage(
      {
        business_name: lead.businessName,
        contact_person: lead.contactPerson,
        locality: lead.locality,
        category: lead.category,
        phone: lead.phoneNormalized,
      },
      campaign.messageTemplate,
    );
    body = composed.body;
    messageSource = composed.source;
  } catch (error) {
    await markFailed(campaignLeadId, leadId, error instanceof Error ? error.message : 'template_error');
    return;
  }

  const reservation = await tryReserveSendSlot(now);
  if (!reservation.ok) {
    if (reservation.reason === 'paused') {
      throw new DelayedSendError('Outreach paused', 30_000);
    }
    if (reservation.reason === 'daily_cap') {
      throw new DelayedSendError('Daily message cap reached', 60 * 60 * 1000);
    }
    throw new DelayedSendError(
      'Minimum delay not elapsed',
      Math.max(reservation.waitMs ?? env.MIN_MESSAGE_DELAY_SECONDS * 1000, 5_000),
    );
  }

  const messageLog = await prisma.messageLog.create({
    data: {
      leadId,
      campaignId,
      direction: MessageDirection.OUTBOUND,
      body,
      deliveryStatus: MessageDeliveryStatus.QUEUED,
    },
  });

  try {
    const result = await sendTextMessage(lead.phoneNormalized, body);

    await prisma.$transaction([
      prisma.messageLog.update({
        where: { id: messageLog.id },
        data: {
          deliveryStatus: MessageDeliveryStatus.ACCEPTED,
          providerMessageId: result.providerMessageId,
          providerRaw: result.raw as Prisma.InputJsonValue,
        },
      }),
      prisma.lead.update({
        where: { id: leadId },
        data: {
          status: LeadStatus.SENT,
          lastSentAt: new Date(),
          lastCampaignId: campaignId,
        },
      }),
      prisma.campaignLead.update({
        where: { id: campaignLeadId },
        data: {
          status: LeadStatus.SENT,
          sentAt: new Date(),
          error: null,
        },
      }),
    ]);

    logger.info(
      {
        leadId,
        campaignId,
        providerMessageId: result.providerMessageId,
        messageSource,
      },
      'Outbound WhatsApp message accepted by provider',
    );
  } catch (error) {
    await releaseSendSlot(now);
    const message =
      error instanceof EvolutionApiError
        ? `Evolution API error ${error.status}`
        : error instanceof Error
          ? error.message
          : 'send_failed';

    await prisma.messageLog.update({
      where: { id: messageLog.id },
      data: {
        deliveryStatus: MessageDeliveryStatus.FAILED,
        error: message,
        providerRaw:
          error instanceof EvolutionApiError
            ? (error.body as Prisma.InputJsonValue)
            : Prisma.JsonNull,
      },
    });

    // Bounded retries via BullMQ — only mark FAILED on final attempt
    if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
      await markFailed(campaignLeadId, leadId, message);
    }

    throw error;
  }
}

async function markFailed(campaignLeadId: string, leadId: string, error: string): Promise<void> {
  await prisma.$transaction([
    prisma.campaignLead.update({
      where: { id: campaignLeadId },
      data: {
        status: LeadStatus.FAILED,
        failedAt: new Date(),
        error,
      },
    }),
    prisma.lead.update({
      where: { id: leadId },
      data: { status: LeadStatus.FAILED },
    }),
  ]);
}
