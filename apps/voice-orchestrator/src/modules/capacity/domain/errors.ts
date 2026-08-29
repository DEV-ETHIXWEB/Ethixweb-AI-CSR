import {
  ForbiddenDomainError,
  TooManyRequestsDomainError,
} from "../../../shared/domain/domain-error";
import type { TenantStatus } from "./tenant-status.port";

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

/**
 * Thrown when a tenant's own lifecycle status (docs/15 §2) is not one of
 * `SERVICEABLE_TENANT_STATUSES` — checked BEFORE capacity admission in
 * StartConversationUseCase (see its own comment on why status comes
 * first), so a suspended/offboarded tenant never reaches the capacity gate
 * or creates a Call row at all. 403, not 404 or 429: the tenant and call
 * are both real and well-formed, this call is just not currently
 * permitted, the same semantic distinction CapacityExceededError draws
 * against 404/409 for its own case.
 */
export class TenantNotServiceableError extends ForbiddenDomainError {
  constructor(
    public readonly tenantId: string,
    public readonly status: TenantStatus,
  ) {
    super(`Tenant ${tenantId} is not currently serviceable (status: ${status}).`);
    this.name = "TenantNotServiceableError";
  }
}
