import { Inject, Injectable } from "@nestjs/common";
import { withRetry } from "@ethixweb/shared-kernel";
import type { StructuredLogger } from "@ethixweb/shared-kernel";
import { APP_LOGGER } from "../../../shared/observability/app-logger.module";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { GetCustomerUseCase } from "../../customers/application/get-customer.use-case";
import { GetLeadUseCase } from "../../leads/application/get-lead.use-case";
import type { NotificationChannel } from "../domain/notification.entity";
import type { NotificationPayload } from "../domain/notification-payload";
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

/**
 * docs/07 §2's notification pipeline, from the `lead.created` outbox
 * event through to per-channel delivery. Per-channel failure never blocks
 * the others (docs/07 §2: "notifications table row per channel, status
 * tracked independently") — one bad Slack webhook URL doesn't stop the
 * SMS from going out. Each channel gets up to 3 attempts via
 * shared-kernel's `withRetry` (real resilience without needing the
 * documented separate BullMQ worker service — see OutboxRelayPoller's own
 * comment on why that's Phase 1-scoped down to an in-process poller here).
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

    const payload: NotificationPayload = {
      leadId: lead.id,
      priority: lead.priority,
      leadType: lead.leadType,
      customerName: customer.name,
      customerPhone: customer.phoneE164,
      address: formatAddress(customer.address),
      problemSummary: lead.problemSummary,
      transcriptLink: null,
    };

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
        const result = await withRetry(() => sender.send(channel.destination, payload), {
          maxAttempts: 3,
          isRetryable: () => true,
        });
        if (!result.success) {
          await this.notificationRepository.markFailed(db, tenantId, notification.id);
          return { channelType: channel.channelType, success: false, error: result.error };
        }
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
        await this.notificationRepository.markFailed(db, tenantId, notification.id);
        const reason = error instanceof Error ? error.message : String(error);
        return { channelType: channel.channelType, success: false, error: reason };
      }
    });
  }
}

function formatAddress(address: Record<string, unknown> | null): string {
  if (!address) {
    return "address on file";
  }
  const parts = [address["street"], address["city"], address["state"], address["zip"]].filter(
    (part): part is string => typeof part === "string" && part.length > 0,
  );
  return parts.length > 0 ? parts.join(", ") : "address on file";
}
