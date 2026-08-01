import { NotFoundDomainError } from "../../../shared/domain/domain-error";

export class NoActiveNotificationChannelsError extends NotFoundDomainError {
  constructor(public readonly businessId: string) {
    super(`No active notification channels configured for business ${businessId}.`);
    this.name = "NoActiveNotificationChannelsError";
  }
}
