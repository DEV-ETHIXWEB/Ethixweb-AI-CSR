import { Injectable, type OnModuleInit } from "@nestjs/common";
import { GenericWebhookSender } from "../infrastructure/senders/generic-webhook.sender";
import {
  SlackWebhookSender,
  TeamsWebhookSender,
} from "../infrastructure/senders/webhook-chat.sender";
import { TwilioSmsSender } from "../infrastructure/senders/twilio-sms.sender";
import { UnconfiguredEmailSender } from "../infrastructure/senders/unconfigured-email.sender";
import { ChannelSenderRegistry } from "./channel-sender-registry";

@Injectable()
export class ChannelSenderRegistrar implements OnModuleInit {
  constructor(
    private readonly registry: ChannelSenderRegistry,
    private readonly twilioSmsSender: TwilioSmsSender,
    private readonly unconfiguredEmailSender: UnconfiguredEmailSender,
    private readonly slackWebhookSender: SlackWebhookSender,
    private readonly teamsWebhookSender: TeamsWebhookSender,
    private readonly genericWebhookSender: GenericWebhookSender,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.twilioSmsSender);
    this.registry.register(this.unconfiguredEmailSender);
    this.registry.register(this.slackWebhookSender);
    this.registry.register(this.teamsWebhookSender);
    this.registry.register(this.genericWebhookSender);
  }
}
