import { TooManyRequestsDomainError } from "../../../shared/domain/domain-error";

/**
 * Thrown when neither this tenant's nor the global capacity ceiling has
 * room for a new call AT ADMISSION TIME. Distinct from
 * `ConversationAlreadyExistsError` (conversation module) — this fires
 * BEFORE a conversation is ever created, so there is no conversationId to
 * attach. Uses the existing `TooManyRequestsDomainError` base (429 +
 * `Retry-After`, already wired through `DomainExceptionFilter`) rather than
 * inventing a new status code — this is exactly the "try again shortly"
 * semantic the Voice Runtime needs to distinguish from "this call/tenant
 * is genuinely invalid" (404) or "already handled" (409).
 */
export class CapacityExceededError extends TooManyRequestsDomainError {
  readonly retryAfterSeconds = 5;

  constructor(
    public readonly tenantId: string,
    public readonly scope: "tenant" | "global",
  ) {
    super(
      scope === "tenant"
        ? `Tenant ${tenantId} has reached its concurrent call limit.`
        : "Global concurrent call capacity has been reached.",
    );
    this.name = "CapacityExceededError";
  }
}
