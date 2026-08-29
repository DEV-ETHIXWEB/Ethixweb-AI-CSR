import { Injectable } from "@nestjs/common";
import type { NotificationDestination } from "../../domain/notification.entity";
import type { NotificationPayload } from "../../domain/notification-payload";
import type {
  NotificationChannelSender,
  SendResult,
} from "../../domain/ports/notification-channel-sender.port";
import { renderSms } from "../../domain/notification-renderers";

// Same unbounded-fetch bug class found and fixed for TwilioCallTransferProvider
// (voice-runtime) and the live-call path this session: Node's fetch has
// no default timeout, and this call had none. A hung Twilio API response
// would have stalled SendLeadNotificationUseCase's per-channel send
// indefinitely rather than failing within its own documented 3-attempt
// retry budget.
const SMS_TIMEOUT_MS = 8000;

/**
 * Twilio Messages API over plain `fetch` (Basic Auth: Account SID +
 * Auth Token), no `twilio` SDK dependency, matching this codebase's
 * established preference for a direct REST call over a heavy SDK
 * (CRM adapters, AI provider adapters). UNVERIFIED AGAINST A LIVE
 * SANDBOX, same epistemic-honesty caveat as every other fetch-based
 * external adapter in this build (no live Twilio credentials in this
 * environment); the request shape is Twilio's publicly documented
 * Messages resource.
 */
@Injectable()
export class TwilioSmsSender implements NotificationChannelSender {
  readonly channelType = "sms";

  async send(
    destination: NotificationDestination,
    payload: NotificationPayload,
  ): Promise<SendResult> {
    if (!destination.phone) {
      return { success: false, error: "sms channel destination is missing a phone number" };
    }
    const accountSid = process.env["TWILIO_ACCOUNT_SID"];
    const authToken = process.env["TWILIO_AUTH_TOKEN"];
    const fromNumber = process.env["TWILIO_FROM_NUMBER"];
    if (!accountSid || !authToken || !fromNumber) {
      return { success: false, error: "Twilio credentials are not configured" };
    }

    try {
      const body = new URLSearchParams({
        To: destination.phone,
        From: fromNumber,
        Body: renderSms(payload),
      });
      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
          },
          body: body.toString(),
          signal: AbortSignal.timeout(SMS_TIMEOUT_MS),
        },
      );
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        return { success: false, error: `Twilio ${response.status}: ${text}` };
      }
      const json = (await response.json()) as { sid?: string };
      return { success: true, providerMessageId: json.sid };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
