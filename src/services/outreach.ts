import { CampaignStatus, LeadStatus, Prisma } from '@prisma/client';
import { loadEnv } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { validateTemplateFields } from '../lib/template.js';
import { getOutreachQueue } from '../queue/queues.js';
import { getDailySentCount, isOutreachPaused, setOutreachPaused } from './rate-limit.js';

export type StartOutreachInput = {
  name?: string;
  leadIds?: string[];
  statuses?: LeadStatus[];
  messageTemplate?: string;
  dailyLimit?: number;
  minDelaySeconds?: number;
};

const DEFAULT_ELIGIBLE: LeadStatus[] = [LeadStatus.PENDING, LeadStatus.FAILED];

export async function startOutreach(input: StartOutreachInput = {}) {
  const env = loadEnv();
  const template = input.messageTemplate ?? env.MESSAGE_TEMPLATE;

  const where: Prisma.LeadWhereInput = {
    status: { in: input.statuses?.length ? input.statuses : DEFAULT_ELIGIBLE },
  };
  if (input.leadIds?.length) {
    where.id = { in: input.leadIds };
  }

  const candidates = await prisma.lead.findMany({ where, orderBy: { createdAt: 'asc' } });

  const eligible = candidates.filter((lead) => {
    if (lead.status === LeadStatus.OPTED_OUT) return false;
    const errors = validateTemplateFields({
      business_name: lead.businessName,
      contact_person: lead.contactPerson,
      locality: lead.locality,
      category: lead.category,
      phone: lead.phoneNormalized,
    });
    return errors.length === 0;
  });

  if (eligible.length === 0) {
    throw Object.assign(new Error('No eligible leads to enqueue'), { statusCode: 400 });
  }

  const campaign = await prisma.campaign.create({
    data: {
      name: input.name?.trim() || `Campaign ${new Date().toISOString()}`,
      status: CampaignStatus.RUNNING,
      messageTemplate: template,
      dailyLimit: input.dailyLimit ?? env.DAILY_MESSAGE_LIMIT,
      minDelaySeconds: input.minDelaySeconds ?? env.MIN_MESSAGE_DELAY_SECONDS,
      timezone: env.TIMEZONE,
      startedAt: new Date(),
    },
  });

  const queue = getOutreachQueue();
  let enqueued = 0;

  for (const lead of eligible) {
    await prisma.$transaction(async (tx) => {
      const campaignLead = await tx.campaignLead.create({
        data: {
          campaignId: campaign.id,
          leadId: lead.id,
          status: LeadStatus.QUEUED,
        },
      });

      await tx.lead.update({
        where: { id: lead.id },
        data: {
          status: LeadStatus.QUEUED,
          lastCampaignId: campaign.id,
        },
      });

      const job = await queue.add(
        'send',
        {
          campaignId: campaign.id,
          campaignLeadId: campaignLead.id,
          leadId: lead.id,
        },
        {
          jobId: `campaign:${campaign.id}:lead:${lead.id}`,
        },
      );

      await tx.campaignLead.update({
        where: { id: campaignLead.id },
        data: { jobId: job.id },
      });
    });
    enqueued += 1;
  }

  await setOutreachPaused(false);

  return {
    campaign,
    requested: candidates.length,
    enqueued,
    skipped: candidates.length - eligible.length,
  };
}

export async function pauseOutreach() {
  await setOutreachPaused(true);
  const running = await prisma.campaign.updateMany({
    where: { status: CampaignStatus.RUNNING },
    data: { status: CampaignStatus.PAUSED, pausedAt: new Date() },
  });
  return { paused: true, campaignsAffected: running.count };
}

export async function resumeOutreach() {
  await setOutreachPaused(false);
  const resumed = await prisma.campaign.updateMany({
    where: { status: CampaignStatus.PAUSED },
    data: { status: CampaignStatus.RUNNING, pausedAt: null },
  });
  return { paused: false, campaignsAffected: resumed.count };
}

export async function getOutreachStats() {
  const env = loadEnv();
  const queue = getOutreachQueue();
  const [waiting, active, delayed, failed, completed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getDelayedCount(),
    queue.getFailedCount(),
    queue.getCompletedCount(),
  ]);

  const [pending, queued, sent, failedLeads, replied, optedOut, converted, campaignsRunning] =
    await Promise.all([
      prisma.lead.count({ where: { status: LeadStatus.PENDING } }),
      prisma.lead.count({ where: { status: LeadStatus.QUEUED } }),
      prisma.lead.count({ where: { status: LeadStatus.SENT } }),
      prisma.lead.count({ where: { status: LeadStatus.FAILED } }),
      prisma.lead.count({ where: { status: LeadStatus.REPLIED } }),
      prisma.lead.count({ where: { status: LeadStatus.OPTED_OUT } }),
      prisma.lead.count({ where: { status: LeadStatus.CONVERTED } }),
      prisma.campaign.count({ where: { status: CampaignStatus.RUNNING } }),
    ]);

  const outboundSent = await prisma.messageLog.count({
    where: { direction: 'OUTBOUND', deliveryStatus: { in: ['ACCEPTED', 'SENT', 'DELIVERED', 'READ'] } },
  });
  const inbound = await prisma.messageLog.count({ where: { direction: 'INBOUND' } });
  const dailySent = await getDailySentCount();
  const paused = await isOutreachPaused();

  return {
    paused,
    timezone: env.TIMEZONE,
    dailyLimit: env.DAILY_MESSAGE_LIMIT,
    dailySent,
    dailyRemaining: Math.max(0, env.DAILY_MESSAGE_LIMIT - dailySent),
    campaignsRunning,
    leads: {
      pending,
      queued,
      sent,
      failed: failedLeads,
      replied,
      optedOut,
      converted,
    },
    messages: {
      outboundAcceptedOrSent: outboundSent,
      inboundReplies: inbound,
    },
    queue: {
      waiting,
      active,
      delayed,
      failed,
      completed,
    },
  };
}

export async function listCampaigns(page = 1, pageSize = 20) {
  const take = Math.min(100, Math.max(1, pageSize));
  const skip = (Math.max(1, page) - 1) * take;
  const [total, items] = await prisma.$transaction([
    prisma.campaign.count(),
    prisma.campaign.findMany({
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: {
        _count: { select: { campaignLeads: true, messages: true } },
      },
    }),
  ]);
  return { page, pageSize: take, total, items };
}

export async function getCampaign(id: string) {
  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: {
      campaignLeads: {
        include: { lead: true },
        orderBy: { queuedAt: 'asc' },
        take: 200,
      },
      _count: { select: { campaignLeads: true, messages: true } },
    },
  });
  if (!campaign) {
    throw Object.assign(new Error('Campaign not found'), { statusCode: 404 });
  }

  const statusCounts = await prisma.campaignLead.groupBy({
    by: ['status'],
    where: { campaignId: id },
    _count: true,
  });

  return { ...campaign, statusCounts };
}
