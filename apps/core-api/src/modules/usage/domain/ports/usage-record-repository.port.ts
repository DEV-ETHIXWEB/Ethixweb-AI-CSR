import type { Prisma, PrismaClient } from "@ethixweb/database";
import type { UsageRecord, UsageType } from "../usage-record.entity";

export type Db = PrismaClient | Prisma.TransactionClient;

export interface CreateUsageRecordInput {
  tenantId: string;
  businessId: string;
  callId: string | null;
  leadId: string | null;
  usageType: UsageType;
  source: string;
  quantity: number;
  unit: string;
  estimatedProviderCostUsd: string | null;
  dedupKey: string;
  metadata: Record<string, unknown>;
  occurredAt: string;
}

export interface UsageSummaryFilter {
  tenantId: string;
  businessId?: string | undefined;
  usageType?: UsageType | undefined;
  callId?: string | undefined;
  /** Inclusive lower bound on `occurredAt`. */
  from: string;
  /** Exclusive upper bound on `occurredAt` — half-open interval, so adjacent billing periods never double-count a record that lands exactly on the boundary. */
  to: string;
}

export interface UsageTypeTotal {
  usageType: UsageType;
  unit: string;
  totalQuantity: number;
  recordCount: number;
  totalEstimatedProviderCostUsd: string | null;
}

export interface UsageRecordRepository {
  /** Throws on a `UNIQUE(tenant_id, dedup_key)` violation — the idempotency backstop, identical discipline to Notification.dedupKey/Lead.callId's own unique-constraint-based dedup elsewhere in this codebase. */
  create(db: Db, input: CreateUsageRecordInput): Promise<UsageRecord>;
  findByDedupKey(db: Db, tenantId: string, dedupKey: string): Promise<UsageRecord | null>;
  /** Deterministic aggregation, grouped by usageType — reproducible from the underlying rows at any time, never a stored/mutated total (docs/26 §3). */
  summarizeByType(db: Db, filter: UsageSummaryFilter): Promise<UsageTypeTotal[]>;
  listByCall(db: Db, tenantId: string, callId: string): Promise<UsageRecord[]>;
}

export const USAGE_RECORD_REPOSITORY = Symbol("USAGE_RECORD_REPOSITORY");
