import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsInt, IsObject, IsOptional, IsUUID, Min } from "class-validator";
import { NOTIFICATION_CHANNEL_TYPES } from "../../domain/notification.entity";

export class CreateNotificationChannelDto {
  @ApiProperty()
  @IsUUID()
  businessId!: string;

  @ApiProperty({ enum: NOTIFICATION_CHANNEL_TYPES })
  @IsIn(NOTIFICATION_CHANNEL_TYPES)
  channelType!: (typeof NOTIFICATION_CHANNEL_TYPES)[number];

  @ApiProperty({
    description:
      "Channel-specific destination — e.g. { phone, userId } for sms, { webhookUrl } for slack/teams/webhook.",
    type: "object",
    additionalProperties: true,
  })
  @IsObject()
  destination!: Record<string, unknown>;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  priorityOrder?: number;
}
