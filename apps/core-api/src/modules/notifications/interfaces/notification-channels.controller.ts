import { Body, Controller, Get, Inject, Post, Query } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from "@nestjs/swagger";
import { CurrentPrincipal } from "../../../shared/auth/current-principal.decorator";
import { Roles } from "../../../shared/auth/roles.decorator";
import type { AuthPrincipal } from "../../../shared/auth/request-principal";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import {
  NOTIFICATION_CHANNEL_REPOSITORY,
  type NotificationChannelRepository,
} from "../domain/ports/notification-channel-repository.port";
import { CreateNotificationChannelDto } from "./dto/create-notification-channel.dto";
import { NotificationChannelResponseDto } from "./dto/notification-channel-response.dto";

/** Dispatcher-facing configuration surface — list + create, same "Phase 1 config-driven, full CRUD is Phase 2" scoping as EmergencyRulesController. */
@ApiBearerAuth("bearer")
@ApiSecurity("api-key")
@ApiTags("notification-channels")
@Roles("owner", "admin")
@Controller("notification-channels")
export class NotificationChannelsController {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(NOTIFICATION_CHANNEL_REPOSITORY)
    private readonly notificationChannelRepository: NotificationChannelRepository,
  ) {}

  @Get()
  @ApiQuery({ name: "businessId", required: true })
  @ApiOperation({ summary: "List active notification channels configured for a business" })
  @ApiResponse({ status: 200, type: [NotificationChannelResponseDto] })
  async list(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query("businessId") businessId: string,
  ): Promise<NotificationChannelResponseDto[]> {
    const channels = await this.tenantContext.run(principal.tenantId, (db) =>
      this.notificationChannelRepository.listActiveByBusiness(db, principal.tenantId, businessId),
    );
    return channels.map((channel) => NotificationChannelResponseDto.fromDomain(channel));
  }

  @Post()
  @ApiOperation({
    summary: "Add a notification channel for a business (sms/email/slack/teams/webhook)",
  })
  @ApiResponse({ status: 201, type: NotificationChannelResponseDto })
  async create(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() dto: CreateNotificationChannelDto,
  ): Promise<NotificationChannelResponseDto> {
    const channel = await this.tenantContext.run(principal.tenantId, (db) =>
      this.notificationChannelRepository.create(db, {
        tenantId: principal.tenantId,
        businessId: dto.businessId,
        channelType: dto.channelType,
        destination: dto.destination,
        priorityOrder: dto.priorityOrder,
      }),
    );
    return NotificationChannelResponseDto.fromDomain(channel);
  }
}
