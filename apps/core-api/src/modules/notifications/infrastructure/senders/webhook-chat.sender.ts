import { Injectable } from "@nestjs/common";
import type { NotificationDestination } from "../../domain/notification.entity";
import type { NotificationPayload } from "../../domain/notification-payload";
import type {
  NotificationChannelSender,
  SendResult,
} from "../../domain/ports/notification-channel-sender.port";
import { renderChatMessage } from "../../domain/notification-renderers";

/** Slack and Teams incoming webhooks are both a plain `POST {text}` to a per-workspace URL — real, simple, no SDK needed for either. One shared base implementation, two thin NestJS-injectable subclasses (a plain constructor-injected string isn't a valid DI token, so subclassing rather than parameterizing one class is what lets both be registered as ordinary providers). */
abstract class BaseWebhookChatSender implements NotificationChannelSender {
  abstract readonly channelType: "slack" | "teams";

  async send(
    destination: NotificationDestination,
    payload: NotificationPayload,
  ): Promise<SendResult> {
    if (!destination.webhookUrl) {
      return {
        success: false,
        error: `${this.channelType} channel destination is missing webhookUrl`,
      };
    }
    try {
      const response = await fetch(destination.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(renderChatMessage(payload)),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        return { success: false, error: `${this.channelType} webhook ${response.status}: ${text}` };
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

@Injectable()
export class SlackWebhookSender extends BaseWebhookChatSender {
  readonly channelType = "slack" as const;
}

@Injectable()
export class TeamsWebhookSender extends BaseWebhookChatSender {
  readonly channelType = "teams" as const;
}
