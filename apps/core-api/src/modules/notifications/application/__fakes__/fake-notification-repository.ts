import { randomUUID } from "node:crypto";
import type { Notification } from "../../domain/notification.entity";
import type {
  CreateNotificationInput,
  Db,
  ListDeadLetterOptions,
  ListNotificationsResult,
  NotificationRepository,
} from "../../domain/ports/notification-repository.port";
import { NotificationDedupKeyExistsError } from "../../infrastructure/prisma-notification.repository";

export class FakeNotificationRepository implements NotificationRepository {
  private readonly notifications = new Map<string, Notification>();

  async create(_db: Db, input: CreateNotificationInput): Promise<Notification> {
    for (const existing of this.notifications.values()) {
      if (existing.tenantId === input.tenantId && existing.dedupKey === input.dedupKey) {
        throw new NotificationDedupKeyExistsError(input.dedupKey);
      }
    }
    const notification: Notification = {
      id: randomUUID(),
      tenantId: input.tenantId,
      leadId: input.leadId,
      channelType: input.channelType,
      destination: input.destination,
      status: input.status,
      dedupKey: input.dedupKey,
      attemptCount: 0,
      sentAt: null,
      createdAt: new Date(),
    };
    this.notifications.set(notification.id, notification);
    return notification;
  }

  async findById(_db: Db, tenantId: string, id: string): Promise<Notification | null> {
    const notification = this.notifications.get(id);
    return notification && notification.tenantId === tenantId ? notification : null;
  }

  async findByDedupKey(_db: Db, tenantId: string, dedupKey: string): Promise<Notification | null> {
    for (const notification of this.notifications.values()) {
      if (notification.tenantId === tenantId && notification.dedupKey === dedupKey) {
        return notification;
      }
    }
    return null;
  }

  async markSent(_db: Db, tenantId: string, id: string): Promise<Notification> {
    return this.updateStatus(tenantId, id, "sent", new Date());
  }

  async markFailed(_db: Db, tenantId: string, id: string): Promise<Notification> {
    return this.updateStatus(tenantId, id, "failed", null);
  }

  async markDeadLetter(_db: Db, tenantId: string, id: string): Promise<Notification> {
    return this.updateStatus(tenantId, id, "dead_letter", null);
  }

  async listByLead(_db: Db, tenantId: string, leadId: string): Promise<Notification[]> {
    return [...this.notifications.values()]
      .filter((n) => n.tenantId === tenantId && n.leadId === leadId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async listDeadLetter(
    _db: Db,
    tenantId: string,
    options: ListDeadLetterOptions,
  ): Promise<ListNotificationsResult> {
    const matches = [...this.notifications.values()]
      .filter((n) => n.tenantId === tenantId && n.status === "dead_letter")
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const start = (options.page - 1) * options.pageSize;
    return { items: matches.slice(start, start + options.pageSize), total: matches.length };
  }

  private updateStatus(
    tenantId: string,
    id: string,
    status: string,
    sentAt: Date | null,
  ): Notification {
    const existing = this.notifications.get(id);
    if (!existing || existing.tenantId !== tenantId) {
      throw new Error(`FakeNotificationRepository: no notification ${id} for tenant ${tenantId}`);
    }
    const updated: Notification = {
      ...existing,
      status,
      sentAt,
      attemptCount: existing.attemptCount + 1,
    };
    this.notifications.set(id, updated);
    return updated;
  }

  /** Test helper. */
  seed(notification: Notification): void {
    this.notifications.set(notification.id, notification);
  }
}
