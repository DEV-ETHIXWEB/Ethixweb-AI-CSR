import type { Prisma, PrismaClient } from "@ethixweb/database";

export type Db = PrismaClient | Prisma.TransactionClient;

export interface RecordAuditLogEntry {
  tenantId: string;
  actorId: string | null;
  actorType: string;
  action: string;
  resourceType: string;
  resourceId: string;
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null;
}

/**
 * Write-only audit trail port, shared across modules (knowledge,
 * capacity-config, and any future module needing the same `AuditLog` row
 * shape) rather than each module reinventing its own — mirrors the
 * Db-parameterized, tenant-scoped-transaction pattern every other
 * repository in this codebase follows (see e.g. leads/domain/ports/
 * lead-repository.port.ts). No read methods: nothing in this build reads
 * audit history back out, so none is speculatively added (YAGNI).
 */
export interface AuditLogRepository {
  record(db: Db, entry: RecordAuditLogEntry): Promise<void>;
}

export const AUDIT_LOG_REPOSITORY = Symbol("AUDIT_LOG_REPOSITORY");
