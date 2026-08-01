import { Injectable } from "@nestjs/common";
import type { Prisma } from "@ethixweb/database";
import type { NotificationChannel } from "../domain/notification.entity";
import type {
  CreateNotificationChannelInput,
  Db,
  NotificationChannelRepository,
} from "../domain/ports/notification-channel-repository.port";

@Injectable()
export class PrismaNotificationChannelRepository implements NotificationChannelRepository {
  async create(db: Db, input: CreateNotificationChannelInput): Promise<NotificationChannel> {
    const row = await db.notificationChannel.create({
      data: {
        tenantId: input.tenantId,
        businessId: input.businessId,
        channelType: input.channelType,
        destination: input.destination as Prisma.InputJsonValue,
        priorityOrder: input.priorityOrder ?? 0,
      },
    });
    return toEntity(row);
  }

  async listActiveByBusiness(
    db: Db,
    tenantId: string,
    businessId: string,
  ): Promise<NotificationChannel[]> {
    const rows = await db.notificationChannel.findMany({
      where: { tenantId, businessId, isActive: true },
      orderBy: { priorityOrder: "asc" },
    });
    return rows.map(toEntity);
  }
}

function toEntity(row: {
  id: string;
  tenantId: string;
  businessId: string;
  channelType: string;
  destination: unknown;
  isActive: boolean;
  priorityOrder: number;
}): NotificationChannel {
  return {
    id: row.id,
    tenantId: row.tenantId,
    businessId: row.businessId,
    channelType: row.channelType,
    destination: row.destination ?? {},
    isActive: row.isActive,
    priorityOrder: row.priorityOrder,
  };
}
