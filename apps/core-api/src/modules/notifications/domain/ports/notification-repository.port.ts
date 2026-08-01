import type { Prisma, PrismaClient } from "@ethixweb/database";
import type { Notification } from "../notification.entity";

export type Db = PrismaClient | Prisma.TransactionClient;

export interface CreateNotificationInput {
  tenantId: string;
  leadId: string;
  channelType: string;
  destination: string;
  status: string;
  dedupKey: string;
}

export interface NotificationRepository {
  /** Throws on a `UNIQUE(dedup_key)` violation — the per-channel idempotency backstop (docs/07 §2/§5.1's own dedup discussion), mirrors every other create-races-to-existing pattern in this codebase. */
  create(db: Db, input: CreateNotificationInput): Promise<Notification>;
  findByDedupKey(db: Db, tenantId: string, dedupKey: string): Promise<Notification | null>;
  markSent(db: Db, tenantId: string, id: string): Promise<Notification>;
  markFailed(db: Db, tenantId: string, id: string): Promise<Notification>;
}

export const NOTIFICATION_REPOSITORY = Symbol("NOTIFICATION_REPOSITORY");
