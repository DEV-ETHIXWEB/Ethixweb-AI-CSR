import { createHmac } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { NotificationDestination } from "../../domain/notification.entity";
import type { NotificationPayload } from "../../domain/notification-payload";
import type {
  NotificationChannelSender,
  SendResult,
} from "../../domain/ports/notification-channel-sender.port";
import { renderGenericWebhook } from "../../domain/notification-renderers";

/** Generic outbound webhook — HMAC-signed (reuses the same `X-Signature: sha256=<hex>` convention this codebase's inbound webhook verifier expects, so a tenant's own receiver can validate authenticity the same way core-api validates CRM webhooks — see shared/webhooks/hmac-signature.util.ts). */
@Injectable()
export class GenericWebhookSender implements NotificationChannelSender {
  readonly channelType = "webhook";

  async send(
    destination: NotificationDestination,
    payload: NotificationPayload,
  ): Promise<SendResult> {
    if (!destination.webhookUrl) {
      return { success: false, error: "webhook channel destination is missing webhookUrl" };
    }
    try {
      const body = JSON.stringify(renderGenericWebhook(payload));
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (destination.webhookSecret) {
        const signature = createHmac("sha256", destination.webhookSecret)
          .update(body)
          .digest("hex");
        headers["X-Signature"] = `sha256=${signature}`;
      }
      const response = await fetch(destination.webhookUrl, { method: "POST", headers, body });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        return { success: false, error: `webhook ${response.status}: ${text}` };
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
