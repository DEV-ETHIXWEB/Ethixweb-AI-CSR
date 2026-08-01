import { Module } from "@nestjs/common";
import { CustomersModule } from "../customers/customers.module";
import { LeadsModule } from "../leads/leads.module";
import { ChannelSenderRegistrar } from "./application/channel-sender-registrar";
import { ChannelSenderRegistry } from "./application/channel-sender-registry";
import { HandleSmsClaimReplyUseCase } from "./application/handle-sms-claim-reply.use-case";
import { SendLeadNotificationUseCase } from "./application/send-lead-notification.use-case";
import { NOTIFICATION_CHANNEL_REPOSITORY } from "./domain/ports/notification-channel-repository.port";
import { NOTIFICATION_REPOSITORY } from "./domain/ports/notification-repository.port";
import { OutboxRelayPoller } from "./infrastructure/outbox-relay.poller";
import { PrismaNotificationChannelRepository } from "./infrastructure/prisma-notification-channel.repository";
import { PrismaNotificationRepository } from "./infrastructure/prisma-notification.repository";
import { PrismaOutboxReader } from "./infrastructure/prisma-outbox-reader";
import { RedisClaimMappingStore } from "./infrastructure/redis-claim-mapping.store";
import { GenericWebhookSender } from "./infrastructure/senders/generic-webhook.sender";
import { TwilioSmsSender } from "./infrastructure/senders/twilio-sms.sender";
import { UnconfiguredEmailSender } from "./infrastructure/senders/unconfigured-email.sender";
import {
  SlackWebhookSender,
  TeamsWebhookSender,
} from "./infrastructure/senders/webhook-chat.sender";
import { NotificationChannelsController } from "./interfaces/notification-channels.controller";
import { SmsWebhooksController } from "./interfaces/sms-webhooks.controller";

/**
 * Imports LeadsModule (GetLeadUseCase, ClaimLeadUseCase) and CustomersModule
 * (GetCustomerUseCase) — the dependency direction matches the module
 * roadmap exactly (Notifications depends on Lead + Customer Management,
 * never the reverse; neither of those modules imports this one).
 */
@Module({
  imports: [LeadsModule, CustomersModule],
  controllers: [NotificationChannelsController, SmsWebhooksController],
  providers: [
    { provide: NOTIFICATION_CHANNEL_REPOSITORY, useClass: PrismaNotificationChannelRepository },
    { provide: NOTIFICATION_REPOSITORY, useClass: PrismaNotificationRepository },
    ChannelSenderRegistry,
    ChannelSenderRegistrar,
    TwilioSmsSender,
    UnconfiguredEmailSender,
    SlackWebhookSender,
    TeamsWebhookSender,
    GenericWebhookSender,
    RedisClaimMappingStore,
    PrismaOutboxReader,
    SendLeadNotificationUseCase,
    HandleSmsClaimReplyUseCase,
    OutboxRelayPoller,
  ],
})
export class NotificationsModule {}
