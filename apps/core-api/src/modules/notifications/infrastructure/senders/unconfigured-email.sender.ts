import { Injectable } from "@nestjs/common";
import type { NotificationDestination } from "../../domain/notification.entity";
import type { NotificationPayload } from "../../domain/notification-payload";
import type {
  NotificationChannelSender,
  SendResult,
} from "../../domain/ports/notification-channel-sender.port";

/**
 * docs/07 §2 lists "Email" as a channel but never pins down a specific
 * vendor (SMTP vs SES — both mentioned, neither confirmed) the way
 * Twilio is confirmed for SMS/voice elsewhere in the docs. Guessing a
 * vendor here (adding an SMTP or SES dependency against an unconfirmed
 * choice) would be exactly the kind of unverified assumption this
 * codebase's docs/05 §2.9 discipline argues against — this sender exists
 * so the `email` channel type is real, registered, and testable in the
 * broker/registry sense, but returns an honest "not configured" failure
 * instead of guessing. Swap for a real vendor adapter once that decision
 * is made; `NotificationChannelSender` is the seam.
 */
@Injectable()
export class UnconfiguredEmailSender implements NotificationChannelSender {
  readonly channelType = "email";

  async send(
    _destination: NotificationDestination,
    _payload: NotificationPayload,
  ): Promise<SendResult> {
    return {
      success: false,
      error:
        "Email channel has no configured vendor (SMTP/SES decision not yet made — see docs/07 §2)",
    };
  }
}
