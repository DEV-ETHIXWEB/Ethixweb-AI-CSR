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
 *
 * DELIBERATELY split across separate `tenantContext.run` calls, not one
 * wrapping everything — same connection-pool-safety fix as
 * customers/application/resolve-customer.use-case.ts (see that class's own
 * comment for the full reasoning). Two distinct reasons here: (1) every
 * registered sender has its own hard timeout (8-10s, see each sender's own
 * `AbortSignal.timeout`), so `sender.send()` must not run inside a held-open
 * transaction; (2) `getLeadUseCase`/`getCustomerUseCase` each open their OWN
 * `tenantContext.run` internally — calling them from inside this class's own
 * transaction meant a nested `$transaction` on top of an already-open one
 * for every redrive, doubling connection-pool pressure for no reason, since
 * nothing here actually needs the notification read, the lead/customer
 * reads, and the final status write to share one transaction.
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

    const notification = await this.tenantContext.run(tenantId, (db) =>
      this.notificationRepository.findById(db, tenantId, notificationId),
    );
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
      await this.tenantContext.run(tenantId, (db) =>
        this.notificationRepository.markSent(db, tenantId, notification.id),
      );
      this.logger.info("dead-lettered notification redriven successfully", {
        tenantId,
        notificationId,
        channelType: notification.channelType,
      });
      return { channelType: notification.channelType, success: true };
    }

    await this.tenantContext.run(tenantId, (db) =>
      this.notificationRepository.markDeadLetter(db, tenantId, notification.id),
    );
    return { channelType: notification.channelType, success: false, error: result.error };
  }
}
