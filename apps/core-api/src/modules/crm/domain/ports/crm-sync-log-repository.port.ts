import type { Prisma, PrismaClient } from "@ethixweb/database";
import type { CrmSyncLog } from "../crm-sync-log.entity";

export type Db = PrismaClient | Prisma.TransactionClient;

export interface RecordCrmSyncInput {
  tenantId: string;
  integrationId: string;
  operation: string;
  entityType: string;
  entityId: string | null;
  status: string;
  idempotencyKey: string;
  requestPayload: unknown;
  responsePayload: unknown;
}

export interface CrmSyncLogRepository {
  /** Append-only — no update/delete method exists because a sync log entry is never revised after the fact, only ever added to. */
  record(db: Db, input: RecordCrmSyncInput): Promise<CrmSyncLog>;
}

export const CRM_SYNC_LOG_REPOSITORY = Symbol("CRM_SYNC_LOG_REPOSITORY");
