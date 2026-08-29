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
 *
 * `sendToChannel` is DELIBERATELY split across separate `tenantContext.run`
 * calls, not one wrapping everything — same connection-pool-safety fix as
 * customers/application/resolve-customer.use-case.ts (see that class's own
 * comment for the full reasoning). Every sender has its own hard timeout
 * (8-10s), and this method retries it up to MAX_SEND_ATTEMPTS times with a
 * short backoff — worst case ~30s of held-open transaction time under the
 * old structure, real but smaller than the CRM-adapter case; still not
 * something to hold a Postgres connection open across. The dedup-reserving
 * `notification` row create must land BEFORE the send attempt (that's what
 * makes the dedup guarantee real), and the final status write must land
 * AFTER — so this is three steps: reserve, send (no transaction open), then
 * record the outcome.
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

    if (channels.length === 0) {
      // Found live, not hypothetical: with zero active channels configured
      // for this business, the loop below is a silent no-op — the outbox
      // event still gets marked "dispatched" (this use-case throws
      // nothing), so nothing anywhere would otherwise indicate that a real
      // lead, possibly an EMERGENCY-priority one, reached zero humans. No
      // metrics/alerting backend exists in this codebase (docs/29 Blocker
      // 5) to page on this, so a loud structured warning is the honest,
      // currently-available signal — the same convention already used for
      // "no sender registered for channel type" just below.
      this.logger.warn(
        "lead notification has NO active channels configured for this business — nobody was notified",
        {
          tenantId: command.tenantId,
          businessId: command.businessId,
          leadId: command.leadId,
          priority: lead.priority,
        },
      );
    }

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

    let notification;
    try {
      notification = await this.tenantContext.run(tenantId, (db) =>
        this.notificationRepository.create(db, {
          tenantId,
          leadId: payload.leadId,
          channelType: channel.channelType,
          destination: JSON.stringify(channel.destination),
          status: "pending",
          dedupKey,
        }),
      );
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

      await this.tenantContext.run(tenantId, (db) =>
        this.notificationRepository.markSent(db, tenantId, notification.id),
      );
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
      await this.tenantContext.run(tenantId, (db) =>
        this.notificationRepository.markDeadLetter(db, tenantId, notification.id),
      );
      this.logger.warn("notification exhausted its retry budget — moved to dead letter", {
        tenantId,
        leadId: payload.leadId,
        channelType: channel.channelType,
        reason,
      });
      return { channelType: channel.channelType, success: false, error: reason };
    }
  }
}

/** Unwraps RetryExhaustedError's `lastError` so the reported reason is the sender's actual error, not the generic "Retry exhausted after N attempt(s)" wrapper message. */
function extractReason(error: unknown): string {
  if (error instanceof RetryExhaustedError) {
    return extractReason(error.lastError);
  }
  return error instanceof Error ? error.message : String(error);
}
