import { ConflictDomainError, NotFoundDomainError } from "../../../shared/domain/domain-error";

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
