import { Inject, Injectable } from "@nestjs/common";
import { RetryExhaustedError, withRetry } from "@ethixweb/shared-kernel";
import type { StructuredLogger } from "@ethixweb/shared-kernel";
import { APP_LOGGER } from "../../../shared/observability/app-logger.module";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { GetCustomerUseCase } from "../../customers/application/get-customer.use-case";
import { GetLeadUseCase } from "../../leads/application/get-lead.use-case";
import type { NotificationChannel } from "../domain/notification.entity";
import { buildNotificationPayload, type NotificationPayload } from "../domain/notification-payload";
import {
  NOTIFICATION_CHANNEL_REPOSITORY,
  type NotificationChannelRepository,
} from "../domain/ports/notification-channel-repository.port";
import {
  NOTIFICATION_REPOSITORY,
  type NotificationRepository,
} from "../domain/ports/notification-repository.port";
import { ChannelSenderRegistry } from "./channel-sender-registry";
import { RedisClaimMappingStore } from "../infrastructure/redis-claim-mapping.store";
import { NotificationDedupKeyExistsError } from "../infrastructure/prisma-notification.repository";

export interface SendLeadNotificationCommand {
  tenantId: string;
  businessId: string;
  leadId: string;
}

export interface ChannelSendOutcome {
  channelType: string;
  success: boolean;
  error?: string | undefined;
}

const MAX_SEND_ATTEMPTS = 3;

/** A sender reporting `{success: false}` — thrown so shared-kernel's `withRetry` actually retries it, since `withRetry` only reacts to a REJECTED promise, and every sender in this build resolves rather than rejects even on failure (see each sender's own try/catch). Caught internally by `sendToChannel`; never escapes this file. */
class SenderReportedFailureError extends Error {}

/**
 * docs/07 §2's notification pipeline, from the `lead.created` outbox
 * event through to per-channel delivery. Per-channel failure never blocks
 * the others (docs/07 §2: "notifications table row per channel, status
 * tracked independently") — one bad Slack webhook URL doesn't stop the
 * SMS from going out. Each channel gets up to 3 real attempts (a sender
 * failure is promoted to a thrown error specifically so shared-kernel's
 * `withRetry` engages — see SenderReportedFailureError's own comment).
 * Once the retry budget is exhausted, the notification moves to the Dead
 * Letter Queue (`status: "dead_letter"`) rather than silently staying
 * `failed` forever — visible via `GET /notifications/dead-letter` and
 * redrivable via `POST /notifications/:id/requeue` (RequeueNotificationUseCase).
 */
@Injectable()
export class SendLeadNotificationUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(NOTIFICATION_CHANNEL_REPOSITORY)
    private readonly channelRepository: NotificationChannelRepository,
    @Inject(NOTIFICATION_REPOSITORY)
    private readonly notificationRepository: NotificationRepository,
    private readonly senderRegistry: ChannelSenderRegistry,
    private readonly getLeadUseCase: GetLeadUseCase,
    private readonly getCustomerUseCase: GetCustomerUseCase,
    private readonly claimMappingStore: RedisClaimMappingStore,
    @Inject(APP_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  async execute(command: SendLeadNotificationCommand): Promise<ChannelSendOutcome[]> {
    setSpanAttributes({
      "ethixweb.tenant_id": command.tenantId,
      "ethixweb.lead_id": command.leadId,
    });

    const [lead, channels] = await Promise.all([
      this.getLeadUseCase.execute(command.tenantId, command.leadId),
      this.tenantContext.run(command.tenantId, (db) =>
        this.channelRepository.listActiveByBusiness(db, command.tenantId, command.businessId),
      ),
    ]);
    const customer = await this.getCustomerUseCase.execute(command.tenantId, lead.customerId);
    const payload = buildNotificationPayload(lead, customer);

    const outcomes: ChannelSendOutcome[] = [];
    for (const channel of channels) {
      outcomes.push(await this.sendToChannel(command.tenantId, channel, payload));
    }
    return outcomes;
  }

  private async sendToChannel(
    tenantId: string,
    channel: NotificationChannel,
    payload: NotificationPayload,
  ): Promise<ChannelSendOutcome> {
    const dedupKey = `notification:${payload.leadId}:${channel.channelType}`;
    const sender = this.senderRegistry.get(channel.channelType);
    if (!sender) {
      this.logger.warn("no sender registered for channel type", {
        channelType: channel.channelType,
      });
      return { channelType: channel.channelType, success: false, error: "no sender registered" };
    }

    return this.tenantContext.run(tenantId, async (db) => {
      let notification;
      try {
        notification = await this.notificationRepository.create(db, {
          tenantId,
          leadId: payload.leadId,
          channelType: channel.channelType,
          destination: JSON.stringify(channel.destination),
          status: "pending",
          dedupKey,
        });
      } catch (error) {
        if (error instanceof NotificationDedupKeyExistsError) {
          // Already sent (or in flight) for this lead+channel — never a
          // second send, matching docs/07 §2's per-lead dedup guarantee.
          return { channelType: channel.channelType, success: true };
        }
        throw error;
      }

      try {
        await withRetry(
          async () => {
            const attempt = await sender.send(channel.destination, payload);
            if (!attempt.success) {
              throw new SenderReportedFailureError(attempt.error ?? "sender reported failure");
            }
            return attempt;
          },
          {
            maxAttempts: MAX_SEND_ATTEMPTS,
            isRetryable: () => true,
            // A short backoff — unlike CRM writes, a transient SMS/webhook
            // failure doesn't need multi-second gaps between attempts, and
            // a live call may already be waiting on the outcome.
            baseDelayMs: 100,
            maxDelayMs: 500,
          },
        );

        await this.notificationRepository.markSent(db, tenantId, notification.id);
        if (
          channel.channelType === "sms" &&
          channel.destination.phone &&
          channel.destination.userId
        ) {
          await this.claimMappingStore.remember(channel.destination.phone, {
            tenantId,
            leadId: payload.leadId,
            userId: channel.destination.userId,
          });
        }
        return { channelType: channel.channelType, success: true };
      } catch (error) {
        const reason = extractReason(error);
        await this.notificationRepository.markDeadLetter(db, tenantId, notification.id);
        this.logger.warn("notification exhausted its retry budget — moved to dead letter", {
          tenantId,
          leadId: payload.leadId,
          channelType: channel.channelType,
          reason,
        });
        return { channelType: channel.channelType, success: false, error: reason };
      }
    });
  }
}

/** Unwraps RetryExhaustedError's `lastError` so the reported reason is the sender's actual error, not the generic "Retry exhausted after N attempt(s)" wrapper message. */
function extractReason(error: unknown): string {
  if (error instanceof RetryExhaustedError) {
    return extractReason(error.lastError);
  }
  return error instanceof Error ? error.message : String(error);
}
