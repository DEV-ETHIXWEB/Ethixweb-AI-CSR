import { Injectable } from "@nestjs/common";
import { Prisma } from "@ethixweb/database";
import type { Notification } from "../domain/notification.entity";
import type {
  CreateNotificationInput,
  Db,
  ListDeadLetterOptions,
  ListNotificationsResult,
  NotificationRepository,
} from "../domain/ports/notification-repository.port";

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

export class NotificationDedupKeyExistsError extends Error {
  constructor(public readonly dedupKey: string) {
    super(`A notification with dedup key "${dedupKey}" already exists.`);
    this.name = "NotificationDedupKeyExistsError";
  }
}

@Injectable()
export class PrismaNotificationRepository implements NotificationRepository {
  async create(db: Db, input: CreateNotificationInput): Promise<Notification> {
    try {
      return await db.notification.create({
        data: {
          tenantId: input.tenantId,
          leadId: input.leadId,
          channelType: input.channelType,
          destination: input.destination,
          status: input.status,
          dedupKey: input.dedupKey,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        throw new NotificationDedupKeyExistsError(input.dedupKey);
      }
      throw error;
    }
  }

  async findById(db: Db, tenantId: string, id: string): Promise<Notification | null> {
    return db.notification.findFirst({ where: { id, tenantId } });
  }

  async findByDedupKey(db: Db, tenantId: string, dedupKey: string): Promise<Notification | null> {
    return db.notification.findFirst({ where: { tenantId, dedupKey } });
  }

  async markSent(db: Db, tenantId: string, id: string): Promise<Notification> {
    await db.notification.updateMany({
      where: { id, tenantId },
      data: { status: "sent", sentAt: new Date(), attemptCount: { increment: 1 } },
    });
    return this.mustFind(db, tenantId, id);
  }

  async markFailed(db: Db, tenantId: string, id: string): Promise<Notification> {
    await db.notification.updateMany({
      where: { id, tenantId },
      data: { status: "failed", attemptCount: { increment: 1 } },
    });
    return this.mustFind(db, tenantId, id);
  }

  async markDeadLetter(db: Db, tenantId: string, id: string): Promise<Notification> {
    await db.notification.updateMany({
      where: { id, tenantId },
      data: { status: "dead_letter", attemptCount: { increment: 1 } },
    });
    return this.mustFind(db, tenantId, id);
  }

  async listByLead(db: Db, tenantId: string, leadId: string): Promise<Notification[]> {
    return db.notification.findMany({
      where: { tenantId, leadId },
      orderBy: { createdAt: "desc" },
    });
  }

  async listDeadLetter(
    db: Db,
    tenantId: string,
    options: ListDeadLetterOptions,
  ): Promise<ListNotificationsResult> {
    const where: Prisma.NotificationWhereInput = { tenantId, status: "dead_letter" };
    const [items, total] = await Promise.all([
      db.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (options.page - 1) * options.pageSize,
        take: options.pageSize,
      }),
      db.notification.count({ where }),
    ]);
    return { items, total };
  }

  private async mustFind(db: Db, tenantId: string, id: string): Promise<Notification> {
    const notification = await db.notification.findFirst({ where: { id, tenantId } });
    if (!notification) {
      throw new Error(`PrismaNotificationRepository: notification ${id} vanished after update`);
    }
    return notification;
  }
}
