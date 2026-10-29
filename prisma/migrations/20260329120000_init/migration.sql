-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('PENDING', 'QUEUED', 'SENT', 'FAILED', 'REPLIED', 'OPTED_OUT', 'CONVERTED');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('OUTBOUND', 'INBOUND');

-- CreateEnum
CREATE TYPE "MessageDeliveryStatus" AS ENUM ('QUEUED', 'ACCEPTED', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "business_name" TEXT NOT NULL,
    "contact_person" TEXT,
    "phone" TEXT NOT NULL,
    "phone_normalized" TEXT NOT NULL,
    "locality" TEXT NOT NULL,
    "category" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "last_campaign_id" TEXT,
    "last_sent_at" TIMESTAMP(3),
    "last_replied_at" TIMESTAMP(3),
    "opted_out_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "message_template" TEXT NOT NULL,
    "daily_limit" INTEGER NOT NULL DEFAULT 35,
    "min_delay_seconds" INTEGER NOT NULL DEFAULT 60,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "started_at" TIMESTAMP(3),
    "paused_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_leads" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "status" "LeadStatus" NOT NULL DEFAULT 'QUEUED',
    "queued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "error" TEXT,
    "job_id" TEXT,

    CONSTRAINT "campaign_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_logs" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "campaign_id" TEXT,
    "direction" "MessageDirection" NOT NULL,
    "body" TEXT NOT NULL,
    "delivery_status" "MessageDeliveryStatus" NOT NULL DEFAULT 'QUEUED',
    "provider_message_id" TEXT,
    "provider_raw" JSONB,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opt_out_events" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "keyword" TEXT,
    "raw_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opt_out_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "event_key" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "instance_name" TEXT,
    "payload" JSONB NOT NULL,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_state" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_state_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "leads_phone_normalized_key" ON "leads"("phone_normalized");

-- CreateIndex
CREATE INDEX "leads_status_idx" ON "leads"("status");

-- CreateIndex
CREATE INDEX "leads_locality_idx" ON "leads"("locality");

-- CreateIndex
CREATE INDEX "leads_category_idx" ON "leads"("category");

-- CreateIndex
CREATE INDEX "leads_created_at_idx" ON "leads"("created_at");

-- CreateIndex
CREATE INDEX "campaigns_status_idx" ON "campaigns"("status");

-- CreateIndex
CREATE INDEX "campaigns_created_at_idx" ON "campaigns"("created_at");

-- CreateIndex
CREATE INDEX "campaign_leads_status_idx" ON "campaign_leads"("status");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_leads_campaign_id_lead_id_key" ON "campaign_leads"("campaign_id", "lead_id");

-- CreateIndex
CREATE INDEX "message_logs_lead_id_created_at_idx" ON "message_logs"("lead_id", "created_at");

-- CreateIndex
CREATE INDEX "message_logs_campaign_id_idx" ON "message_logs"("campaign_id");

-- CreateIndex
CREATE INDEX "message_logs_direction_idx" ON "message_logs"("direction");

-- CreateIndex
CREATE INDEX "message_logs_delivery_status_idx" ON "message_logs"("delivery_status");

-- CreateIndex
CREATE INDEX "message_logs_provider_message_id_idx" ON "message_logs"("provider_message_id");

-- CreateIndex
CREATE INDEX "opt_out_events_lead_id_idx" ON "opt_out_events"("lead_id");

-- CreateIndex
CREATE INDEX "opt_out_events_created_at_idx" ON "opt_out_events"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_event_key_key" ON "webhook_events"("event_key");

-- CreateIndex
CREATE INDEX "webhook_events_event_type_idx" ON "webhook_events"("event_type");

-- CreateIndex
CREATE INDEX "webhook_events_created_at_idx" ON "webhook_events"("created_at");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_last_campaign_id_fkey" FOREIGN KEY ("last_campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_leads" ADD CONSTRAINT "campaign_leads_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_leads" ADD CONSTRAINT "campaign_leads_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_logs" ADD CONSTRAINT "message_logs_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_logs" ADD CONSTRAINT "message_logs_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opt_out_events" ADD CONSTRAINT "opt_out_events_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
