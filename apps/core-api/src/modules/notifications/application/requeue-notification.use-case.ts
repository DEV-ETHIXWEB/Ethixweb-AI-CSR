import { Inject, Injectable } from "@nestjs/common";
import type { StructuredLogger } from "@ethixweb/shared-kernel";
import { APP_LOGGER } from "../../../shared/observability/app-logger.module";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { GetCustomerUseCase } from "../../customers/application/get-customer.use-case";
import { GetLeadUseCase } from "../../leads/application/get-lead.use-case";
import { buildNotificationPayload } from "../domain/notification-payload";
import type { NotificationDestination } from "../domain/notification.entity";
import { NotificationNotFoundError, NotificationNotRequeueableError } from "../domain/errors";
import {
  NOTIFICATION_REPOSITORY,
  type NotificationRepository,
} from "../domain/ports/notification-repository.port";
import { ChannelSenderRegistry } from "./channel-sender-registry";
import type { ChannelSendOutcome } from "./send-lead-notification.use-case";

/**
 * The Dead Letter Queue's redrive operation: re-fetches the lead/customer
 * fresh (so a stale problem_summary/priority from before a since-applied
 * `updateLead` never gets redelivered), re-renders through the exact same
 * `buildNotificationPayload` SendLeadNotificationUseCase uses, and
 * attempts exactly one more send via the channel's own registered sender.
 * Only `dead_letter` notifications are requeueable — a `sent` notification
 * requeued would violate docs/07 §2's "exactly one notification fan-out
 * per lead" guarantee, and a `pending` one is (or should be) already
 * in-flight.
 */
@Injectable()
export class RequeueNotificationUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(NOTIFICATION_REPOSITORY)
    private readonly notificationRepository: NotificationRepository,
    private readonly senderRegistry: ChannelSenderRegistry,
    private readonly getLeadUseCase: GetLeadUseCase,
    private readonly getCustomerUseCase: GetCustomerUseCase,
    @Inject(APP_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  async execute(tenantId: string, notificationId: string): Promise<ChannelSendOutcome> {
    setSpanAttributes({
      "ethixweb.tenant_id": tenantId,
      "ethixweb.notification_id": notificationId,
    });

    return this.tenantContext.run(tenantId, async (db) => {
      const notification = await this.notificationRepository.findById(db, tenantId, notificationId);
      if (!notification) {
        throw new NotificationNotFoundError(notificationId);
      }
      if (notification.status !== "dead_letter") {
        throw new NotificationNotRequeueableError(notificationId, notification.status);
      }

      const sender = this.senderRegistry.get(notification.channelType);
      if (!sender) {
        return {
          channelType: notification.channelType,
          success: false,
          error: "no sender registered",
        };
      }

      const lead = await this.getLeadUseCase.execute(tenantId, notification.leadId);
      const customer = await this.getCustomerUseCase.execute(tenantId, lead.customerId);
      const payload = buildNotificationPayload(lead, customer);
      const destination = JSON.parse(notification.destination) as NotificationDestination;

      const result = await sender.send(destination, payload);
      if (result.success) {
        await this.notificationRepository.markSent(db, tenantId, notification.id);
        this.logger.info("dead-lettered notification redriven successfully", {
          tenantId,
          notificationId,
          channelType: notification.channelType,
        });
        return { channelType: notification.channelType, success: true };
      }

      await this.notificationRepository.markDeadLetter(db, tenantId, notification.id);
      return { channelType: notification.channelType, success: false, error: result.error };
    });
  }
}
