-- Knowledge & Voice Content (docs/38-knowledge-and-voice-content.md) and
-- per-tenant Capacity Configuration (docs/36-capacity-and-branded-waiting.md,
-- docs/37-operations-dashboard.md).
--
-- `knowledge_items.status` and both boolean flags are the DRAFT/APPROVED/
-- DISABLED lifecycle and the independent AI-Knowledge / Waiting-Brochure
-- axes — see the model-level comment in prisma/schema.prisma for why this
-- is plain TEXT rather than a new enum (no pre-existing cited ADR/doc state
-- machine backs this specific value set, matching this schema's existing
-- Business.status/Notification.status precedent).
--
-- `tenant_capacity_configs` is one-row-per-business (UNIQUE business_id);
-- absence of a row means "use the platform default", the same convention
-- AgentConfig's own absence-means-default precedent already established.

-- CreateTable
CREATE TABLE "knowledge_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "ai_knowledge" BOOLEAN NOT NULL DEFAULT false,
    "waiting_brochure" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "updated_by_user_id" UUID,
    "approved_by_user_id" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "knowledge_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_capacity_configs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "max_tenant_concurrent_calls" INTEGER NOT NULL DEFAULT 10,
    "max_waiting_callers" INTEGER NOT NULL DEFAULT 5,
    "waiting_timeout_ms" INTEGER NOT NULL DEFAULT 30000,
    "emergency_headroom_ratio" DOUBLE PRECISION NOT NULL DEFAULT 0.2,
    "overflow_number" TEXT,
    "brochure_enabled" BOOLEAN NOT NULL DEFAULT false,
    "brochure_rotation_ms" INTEGER NOT NULL DEFAULT 15000,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenant_capacity_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "knowledge_items_tenant_id_idx" ON "knowledge_items"("tenant_id");

-- CreateIndex
CREATE INDEX "knowledge_items_business_id_status_idx" ON "knowledge_items"("business_id", "status");

-- CreateIndex
CREATE INDEX "knowledge_items_business_id_waiting_brochure_status_priority_idx" ON "knowledge_items"("business_id", "waiting_brochure", "status", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_capacity_configs_business_id_key" ON "tenant_capacity_configs"("business_id");

-- CreateIndex
CREATE INDEX "tenant_capacity_configs_tenant_id_idx" ON "tenant_capacity_configs"("tenant_id");

-- AddForeignKey
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_capacity_configs" ADD CONSTRAINT "tenant_capacity_configs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
