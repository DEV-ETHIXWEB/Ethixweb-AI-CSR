import {
  ConflictDomainError,
  ForbiddenDomainError,
  NotFoundDomainError,
} from "../../../shared/domain/domain-error";

export class NoActiveNotificationChannelsError extends NotFoundDomainError {
  constructor(public readonly businessId: string) {
    super(`No active notification channels configured for business ${businessId}.`);
    this.name = "NoActiveNotificationChannelsError";
  }
}

export class NotificationNotFoundError extends NotFoundDomainError {
  constructor(public readonly notificationId: string) {
    super(`Notification not found: ${notificationId}`);
    this.name = "NotificationNotFoundError";
  }
}

export class NotificationNotRequeueableError extends ConflictDomainError {
  constructor(
    public readonly notificationId: string,
    public readonly status: string,
  ) {
    super(
      `Notification ${notificationId} is not requeueable (status: ${status}) — only dead_letter notifications can be redriven.`,
    );
    this.name = "NotificationNotRequeueableError";
  }
}

/**
 * 403, not 401 — matches Twilio's own documented recommendation for a
 * signature-verification failure on an inbound webhook (this isn't "you
 * forgot to authenticate," it's "the signature you presented doesn't
 * match," which is what 401 vs. 403 exists to distinguish). Deliberately
 * doesn't say WHICH check failed (missing header vs. mismatched signature
 * vs. missing server-side secret) in the message returned to the caller —
 * Twilio itself is the only real caller of this route, and a more specific
 * message would only help an attacker probing the endpoint.
 */
export class InvalidTwilioSignatureError extends ForbiddenDomainError {
  constructor() {
    super("Twilio signature verification failed.");
    this.name = "InvalidTwilioSignatureError";
  }
}
