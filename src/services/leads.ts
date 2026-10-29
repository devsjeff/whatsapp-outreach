import { LeadStatus, Prisma, type Lead } from '@prisma/client';
import { loadEnv } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { normalizePhone } from '../lib/phone.js';
import { parseLeadsCsv } from './csv.js';

export type CreateLeadInput = {
  businessName: string;
  contactPerson?: string | null;
  phone: string;
  locality: string;
  category?: string | null;
  notes?: string | null;
};

export type ImportSummary = {
  total: number;
  successful: number;
  skipped: number;
  invalid: number;
  details: Array<{
    row: number;
    status: 'successful' | 'skipped' | 'invalid';
    reason?: string;
    phone?: string;
    leadId?: string;
  }>;
};

export async function createLead(input: CreateLeadInput): Promise<Lead> {
  const env = loadEnv();
  const phoneResult = normalizePhone(input.phone, env.DEFAULT_PHONE_COUNTRY as 'IN');
  if (!phoneResult.ok) {
    throw Object.assign(new Error(phoneResult.error), { statusCode: 400 });
  }

  const existing = await prisma.lead.findUnique({
    where: { phoneNormalized: phoneResult.e164Digits },
  });
  if (existing) {
    throw Object.assign(new Error('Lead with this phone number already exists'), {
      statusCode: 409,
      leadId: existing.id,
    });
  }

  return prisma.lead.create({
    data: {
      businessName: input.businessName.trim(),
      contactPerson: input.contactPerson?.trim() || null,
      phone: phoneResult.display,
      phoneNormalized: phoneResult.e164Digits,
      locality: input.locality.trim(),
      category: input.category?.trim() || null,
      notes: input.notes?.trim() || null,
      status: LeadStatus.PENDING,
    },
  });
}

export async function importLeadsFromCsv(content: Buffer | string): Promise<ImportSummary> {
  const env = loadEnv();
  const { rows, invalidHeaders } = parseLeadsCsv(content);

  if (invalidHeaders.length > 0) {
    throw Object.assign(
      new Error(`CSV missing required columns: ${invalidHeaders.join(', ')}`),
      { statusCode: 400 },
    );
  }

  const summary: ImportSummary = {
    total: rows.length,
    successful: 0,
    skipped: 0,
    invalid: 0,
    details: [],
  };

  for (const row of rows) {
    if (!row.business_name.trim() || !row.phone.trim() || !row.locality.trim()) {
      summary.invalid += 1;
      summary.details.push({
        row: row.rowNumber,
        status: 'invalid',
        reason: 'business_name, phone, and locality are required',
      });
      continue;
    }

    const phoneResult = normalizePhone(row.phone, env.DEFAULT_PHONE_COUNTRY as 'IN');
    if (!phoneResult.ok) {
      summary.invalid += 1;
      summary.details.push({
        row: row.rowNumber,
        status: 'invalid',
        reason: phoneResult.error,
        phone: row.phone,
      });
      continue;
    }

    const existing = await prisma.lead.findUnique({
      where: { phoneNormalized: phoneResult.e164Digits },
    });

    if (existing) {
      // Preserve opt-out; refresh non-status fields on re-import
      await prisma.lead.update({
        where: { id: existing.id },
        data: {
          businessName: row.business_name.trim(),
          contactPerson: row.contact_person.trim() || existing.contactPerson,
          locality: row.locality.trim(),
          category: row.category.trim() || existing.category,
          phone: phoneResult.display,
          // Never change OPTED_OUT status on re-import
          status: existing.status === LeadStatus.OPTED_OUT ? LeadStatus.OPTED_OUT : existing.status,
        },
      });
      summary.skipped += 1;
      summary.details.push({
        row: row.rowNumber,
        status: 'skipped',
        reason:
          existing.status === LeadStatus.OPTED_OUT
            ? 'duplicate phone; opt-out preserved'
            : 'duplicate phone; profile updated',
        phone: phoneResult.e164Digits,
        leadId: existing.id,
      });
      continue;
    }

    const lead = await prisma.lead.create({
      data: {
        businessName: row.business_name.trim(),
        contactPerson: row.contact_person.trim() || null,
        phone: phoneResult.display,
        phoneNormalized: phoneResult.e164Digits,
        locality: row.locality.trim(),
        category: row.category.trim() || null,
        status: LeadStatus.PENDING,
      },
    });

    summary.successful += 1;
    summary.details.push({
      row: row.rowNumber,
      status: 'successful',
      phone: phoneResult.e164Digits,
      leadId: lead.id,
    });
  }

  return summary;
}

export async function listLeads(params: {
  page?: number;
  pageSize?: number;
  status?: LeadStatus;
  search?: string;
}) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
  const where: Prisma.LeadWhereInput = {};

  if (params.status) where.status = params.status;
  if (params.search) {
    where.OR = [
      { businessName: { contains: params.search, mode: 'insensitive' } },
      { contactPerson: { contains: params.search, mode: 'insensitive' } },
      { phone: { contains: params.search } },
      { phoneNormalized: { contains: params.search.replace(/\D/g, '') } },
      { locality: { contains: params.search, mode: 'insensitive' } },
    ];
  }

  const [total, items] = await prisma.$transaction([
    prisma.lead.count({ where }),
    prisma.lead.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize) || 1,
    items,
  };
}

export async function getLead(id: string) {
  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) {
    throw Object.assign(new Error('Lead not found'), { statusCode: 404 });
  }
  return lead;
}

export async function updateLead(
  id: string,
  data: Partial<CreateLeadInput> & { status?: LeadStatus },
) {
  const existing = await getLead(id);
  const env = loadEnv();

  let phone = existing.phone;
  let phoneNormalized = existing.phoneNormalized;

  if (data.phone && data.phone !== existing.phone) {
    const phoneResult = normalizePhone(data.phone, env.DEFAULT_PHONE_COUNTRY as 'IN');
    if (!phoneResult.ok) {
      throw Object.assign(new Error(phoneResult.error), { statusCode: 400 });
    }
    const conflict = await prisma.lead.findFirst({
      where: {
        phoneNormalized: phoneResult.e164Digits,
        NOT: { id },
      },
    });
    if (conflict) {
      throw Object.assign(new Error('Another lead already uses this phone number'), {
        statusCode: 409,
      });
    }
    phone = phoneResult.display;
    phoneNormalized = phoneResult.e164Digits;
  }

  return prisma.lead.update({
    where: { id },
    data: {
      businessName: data.businessName?.trim() ?? undefined,
      contactPerson:
        data.contactPerson === undefined ? undefined : data.contactPerson?.trim() || null,
      locality: data.locality?.trim() ?? undefined,
      category: data.category === undefined ? undefined : data.category?.trim() || null,
      notes: data.notes === undefined ? undefined : data.notes?.trim() || null,
      status: data.status,
      phone,
      phoneNormalized,
    },
  });
}

export async function optOutLead(id: string, source = 'manual', keyword?: string, rawText?: string) {
  return prisma.$transaction(async (tx) => {
    const lead = await tx.lead.findUnique({ where: { id } });
    if (!lead) {
      throw Object.assign(new Error('Lead not found'), { statusCode: 404 });
    }

    const updated = await tx.lead.update({
      where: { id },
      data: {
        status: LeadStatus.OPTED_OUT,
        optedOutAt: lead.optedOutAt ?? new Date(),
      },
    });

    await tx.optOutEvent.create({
      data: {
        leadId: id,
        source,
        keyword: keyword ?? null,
        rawText: rawText ?? null,
      },
    });

    return updated;
  });
}

export async function getLeadMessages(id: string, page = 1, pageSize = 50) {
  await getLead(id);
  const take = Math.min(100, Math.max(1, pageSize));
  const skip = (Math.max(1, page) - 1) * take;

  const [total, items] = await prisma.$transaction([
    prisma.messageLog.count({ where: { leadId: id } }),
    prisma.messageLog.findMany({
      where: { leadId: id },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
  ]);

  return { page, pageSize: take, total, items };
}
