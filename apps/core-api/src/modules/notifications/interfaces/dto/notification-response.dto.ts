import { ApiProperty } from "@nestjs/swagger";
import type { Notification } from "../../domain/notification.entity";
import type { ChannelSendOutcome } from "../../application/send-lead-notification.use-case";

export class NotificationResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() leadId: string;
  @ApiProperty() channelType: string;
  @ApiProperty() status: string;
  @ApiProperty() attemptCount: number;
  @ApiProperty({ nullable: true }) sentAt: string | null;
  @ApiProperty() createdAt: string;

  private constructor(notification: Notification) {
    this.id = notification.id;
    this.leadId = notification.leadId;
    this.channelType = notification.channelType;
    this.status = notification.status;
    this.attemptCount = notification.attemptCount;
    this.sentAt = notification.sentAt ? notification.sentAt.toISOString() : null;
    this.createdAt = notification.createdAt.toISOString();
  }

  static fromDomain(notification: Notification): NotificationResponseDto {
    return new NotificationResponseDto(notification);
  }
}

export class PaginatedNotificationsResponseDto {
  @ApiProperty({ type: [NotificationResponseDto] }) items: NotificationResponseDto[];
  @ApiProperty() total: number;

  constructor(items: Notification[], total: number) {
    this.items = items.map((item) => NotificationResponseDto.fromDomain(item));
    this.total = total;
  }
}

export class RequeueNotificationResponseDto {
  @ApiProperty() channelType: string;
  @ApiProperty() success: boolean;
  @ApiProperty({ nullable: true }) error: string | null;

  constructor(outcome: ChannelSendOutcome) {
    this.channelType = outcome.channelType;
    this.success = outcome.success;
    this.error = outcome.error ?? null;
  }
}
