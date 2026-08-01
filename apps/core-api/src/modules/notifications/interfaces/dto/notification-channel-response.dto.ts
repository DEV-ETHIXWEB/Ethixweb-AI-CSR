import { ApiProperty } from "@nestjs/swagger";
import type { NotificationChannel } from "../../domain/notification.entity";

export class NotificationChannelResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() businessId: string;
  @ApiProperty() channelType: string;
  @ApiProperty({ type: "object", additionalProperties: true }) destination: Record<string, unknown>;
  @ApiProperty() isActive: boolean;
  @ApiProperty() priorityOrder: number;

  private constructor(channel: NotificationChannel) {
    this.id = channel.id;
    this.businessId = channel.businessId;
    this.channelType = channel.channelType;
    this.destination = channel.destination as Record<string, unknown>;
    this.isActive = channel.isActive;
    this.priorityOrder = channel.priorityOrder;
  }

  static fromDomain(channel: NotificationChannel): NotificationChannelResponseDto {
    return new NotificationChannelResponseDto(channel);
  }
}
