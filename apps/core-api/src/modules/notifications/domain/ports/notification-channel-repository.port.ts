import type { Prisma, PrismaClient } from "@ethixweb/database";
import type { NotificationChannel, NotificationDestination } from "../notification.entity";

export type Db = PrismaClient | Prisma.TransactionClient;

export interface CreateNotificationChannelInput {
  tenantId: string;
  businessId: string;
  channelType: string;
  destination: NotificationDestination;
  priorityOrder?: number | undefined;
}

export interface NotificationChannelRepository {
  create(db: Db, input: CreateNotificationChannelInput): Promise<NotificationChannel>;
  /** Active only, ordered by `priorityOrder` — the fan-out order docs/07 §2 describes. */
  listActiveByBusiness(
    db: Db,
    tenantId: string,
    businessId: string,
  ): Promise<NotificationChannel[]>;
}

export const NOTIFICATION_CHANNEL_REPOSITORY = Symbol("NOTIFICATION_CHANNEL_REPOSITORY");
