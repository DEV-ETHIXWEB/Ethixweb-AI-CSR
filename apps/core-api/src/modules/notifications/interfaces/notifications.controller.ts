import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
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
import { RequeueNotificationUseCase } from "../application/requeue-notification.use-case";
import {
  NOTIFICATION_REPOSITORY,
  type NotificationRepository,
} from "../domain/ports/notification-repository.port";
import { ListDeadLetterQueryDto } from "./dto/list-dead-letter-query.dto";
import {
  NotificationResponseDto,
  PaginatedNotificationsResponseDto,
  RequeueNotificationResponseDto,
} from "./dto/notification-response.dto";

/** Delivery-history and Dead Letter Queue surface — dispatcher-facing visibility into what docs/07 §2's "notifications table row per channel, status tracked independently" actually produced. */
@ApiBearerAuth("bearer")
@ApiSecurity("api-key")
@ApiTags("notifications")
@Roles("owner", "admin", "dispatcher")
@Controller("notifications")
export class NotificationsController {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(NOTIFICATION_REPOSITORY)
    private readonly notificationRepository: NotificationRepository,
    private readonly requeueNotification: RequeueNotificationUseCase,
  ) {}

  @Get()
  @ApiQuery({ name: "leadId", required: true })
  @ApiOperation({
    summary: "Delivery history for one lead — every channel attempted, newest first",
  })
  @ApiResponse({ status: 200, type: [NotificationResponseDto] })
  async listByLead(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query("leadId", ParseUUIDPipe) leadId: string,
  ): Promise<NotificationResponseDto[]> {
    const notifications = await this.tenantContext.run(principal.tenantId, (db) =>
      this.notificationRepository.listByLead(db, principal.tenantId, leadId),
    );
    return notifications.map((notification) => NotificationResponseDto.fromDomain(notification));
  }

  @Get("dead-letter")
  @ApiOperation({
    summary: "The Dead Letter Queue — notifications that exhausted their retry budget",
  })
  @ApiResponse({ status: 200, type: PaginatedNotificationsResponseDto })
  async listDeadLetter(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query() query: ListDeadLetterQueryDto,
  ): Promise<PaginatedNotificationsResponseDto> {
    const result = await this.tenantContext.run(principal.tenantId, (db) =>
      this.notificationRepository.listDeadLetter(db, principal.tenantId, {
        page: query.page,
        pageSize: query.pageSize,
      }),
    );
    return new PaginatedNotificationsResponseDto(result.items, result.total);
  }

  @Post(":id/requeue")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Redrive a dead-lettered notification — one more send attempt" })
  @ApiResponse({ status: 200, type: RequeueNotificationResponseDto })
  @ApiResponse({ status: 404, description: "No such notification for this tenant" })
  @ApiResponse({ status: 409, description: "Notification is not in dead_letter status" })
  async requeue(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<RequeueNotificationResponseDto> {
    const outcome = await this.requeueNotification.execute(principal.tenantId, id);
    return new RequeueNotificationResponseDto(outcome);
  }
}
