import {
  ConflictDomainError,
  ForbiddenDomainError,
  NotFoundDomainError,
  UnauthorizedDomainError,
  ValidationDomainError,
} from "../../../shared/domain/domain-error";

export class IntegrationNotFoundError extends NotFoundDomainError {
  constructor(public readonly integrationId: string) {
    super(`Integration not found: ${integrationId}`);
    this.name = "IntegrationNotFoundError";
  }
}

/**
 * Thrown by every stub adapter (ServiceTitan/Jobber/Service Fusion/FieldEdge)
 * — per docs/13-implementation-backlog.md's crm-integration module §7,
 * these exist only to prove the CRMAdapter abstraction is genuinely
 * CRM-agnostic before a second real implementation is built; every method
 * throws this rather than silently no-op-ing, so a caller can never mistake
 * "not implemented yet" for "implemented and did nothing."
 */
export class CrmAdapterNotImplementedError extends ForbiddenDomainError {
  constructor(
    public readonly crmType: string,
    public readonly operation: string,
  ) {
    super(`"${operation}" is not implemented for CRM type "${crmType}" yet.`);
    this.name = "CrmAdapterNotImplementedError";
  }
}

export class UnknownCrmTypeError extends ValidationDomainError {
  constructor(public readonly crmType: string) {
    super(`Unknown CRM type: "${crmType}"`);
    this.name = "UnknownCrmTypeError";
  }
}

/**
 * The CRM rejected our credentials (expired/revoked API key, failed OAuth
 * refresh) — distinct from a generic adapter/network failure because it
 * should stop the retry policy immediately (retrying a bad credential 6
 * times wastes the CRM's rate-limit budget for no benefit) and should flip
 * Integration.status to `invalid_credentials`, surfacing to the tenant that
 * they need to reconnect, not just log noise.
 */
export class CrmAuthenticationError extends UnauthorizedDomainError {
  constructor(
    public readonly crmType: string,
    reason: string,
  ) {
    super(`Authentication with "${crmType}" failed: ${reason}`);
    this.name = "CrmAuthenticationError";
  }
}

/** Generic adapter-level failure (network error, unexpected response shape) not covered by a more specific error above. */
export class CrmAdapterError extends ConflictDomainError {
  constructor(
    public readonly crmType: string,
    public readonly operation: string,
    reason: string,
  ) {
    super(`CRM adapter operation "${operation}" failed for "${crmType}": ${reason}`);
    this.name = "CrmAdapterError";
  }
}

export class InvalidCrmWebhookSignatureError extends UnauthorizedDomainError {
  constructor(public readonly crmType: string) {
    super(`Invalid webhook signature for "${crmType}"`);
    this.name = "InvalidCrmWebhookSignatureError";
  }
}

/**
 * A caller-supplied idempotency key is already being processed by a
 * concurrent request — the `in_flight` outcome of shared-kernel's
 * `IdempotencyStore.begin()`. Distinct from a completed-and-cached result
 * (which returns normally, not an error): this means "come back shortly,"
 * not "here's your answer."
 */
export class CrmSyncInProgressError extends ConflictDomainError {
  constructor(public readonly idempotencyKey: string) {
    super(`A request with idempotency key "${idempotencyKey}" is already in progress.`);
    this.name = "CrmSyncInProgressError";
  }
}
