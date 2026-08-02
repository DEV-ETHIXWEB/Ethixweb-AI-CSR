-- Phase 9 — usage & metering, docs/26-usage-metering.md.
--
-- Deliberately NOT a billing/pricing table: see the model-level comment in
-- prisma/schema.prisma directly above `UsageRecord` for the full reasoning
-- (ADR-008 / docs/15 §3.1 — Stripe is the billing system of record, this
-- is the one normalized measurement layer that feeds it, not a parallel
-- pricing/ledger engine).
--
-- `call_id` is intentionally NOT a foreign key to `calls.id` — see that
-- same schema comment for the pre-existing gap this works around (no code
-- in this repository currently inserts a `Call` row, so an FK here would
-- make every usage-ingestion write fail against real Postgres today).

-- CreateTable
CREATE TABLE "usage_records" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "call_id" UUID,
    "lead_id" UUID,
    "usage_type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit" TEXT NOT NULL,
    "estimated_provider_cost_usd" DECIMAL(10,6),
    "dedup_key" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usage_records_tenant_id_dedup_key_key" ON "usage_records"("tenant_id", "dedup_key");

-- CreateIndex
CREATE INDEX "usage_records_tenant_id_usage_type_occurred_at_idx" ON "usage_records"("tenant_id", "usage_type", "occurred_at");

-- CreateIndex
CREATE INDEX "usage_records_tenant_id_business_id_occurred_at_idx" ON "usage_records"("tenant_id", "business_id", "occurred_at");

-- CreateIndex
CREATE INDEX "usage_records_call_id_idx" ON "usage_records"("call_id");
