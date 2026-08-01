import { randomUUID } from "node:crypto";
import type { NotificationChannel } from "../../domain/notification.entity";
import type {
  CreateNotificationChannelInput,
  Db,
  NotificationChannelRepository,
} from "../../domain/ports/notification-channel-repository.port";

export class FakeNotificationChannelRepository implements NotificationChannelRepository {
  private readonly channels: NotificationChannel[] = [];

  async create(_db: Db, input: CreateNotificationChannelInput): Promise<NotificationChannel> {
    const channel: NotificationChannel = {
      id: randomUUID(),
      tenantId: input.tenantId,
      businessId: input.businessId,
      channelType: input.channelType,
      destination: input.destination,
      isActive: true,
      priorityOrder: input.priorityOrder ?? 0,
    };
    this.channels.push(channel);
    return channel;
  }

  async listActiveByBusiness(
    _db: Db,
    tenantId: string,
    businessId: string,
  ): Promise<NotificationChannel[]> {
    return this.channels
      .filter((c) => c.tenantId === tenantId && c.businessId === businessId && c.isActive)
      .sort((a, b) => a.priorityOrder - b.priorityOrder);
  }

  /** Test helper. */
  seed(channel: NotificationChannel): void {
    this.channels.push(channel);
  }
}
