import { NotFoundDomainError } from "../../../shared/domain/domain-error";

export class CustomerNotFoundError extends NotFoundDomainError {
  constructor(public readonly customerId: string) {
    super(`Customer not found: ${customerId}`);
    this.name = "CustomerNotFoundError";
  }
}

/**
 * Resolving or creating a customer requires an active CRM integration for
 * the business — per docs/15-tenant-lifecycle-billing-and-analytics.md §1's
 * onboarding flow, "Connect CRM" happens before any customer/lead activity
 * is possible at all. Distinct from CrmModule's own IntegrationNotFoundError
 * (a specific integration id that doesn't exist) — this is "this business
 * has no active integration to use in the first place," a customers-module
 * concern about which integration to pick, not a lookup-by-id failure.
 */
export class NoCrmIntegrationConfiguredError extends NotFoundDomainError {
  constructor(public readonly businessId: string) {
    super(`No active CRM integration is configured for business ${businessId}.`);
    this.name = "NoCrmIntegrationConfiguredError";
  }
}

/**
 * Internal control-flow signal, NOT a DomainError — deliberately does not
 * extend the DomainError hierarchy so it can never be accidentally mapped
 * to an HTTP response by DomainExceptionFilter. Per
 * docs/13-implementation-backlog.md `customers` module §4, hitting the
 * `(business_id, phone_e164)` unique constraint concurrently is NOT an
 * error from the caller's perspective — the documented behavior is "catch
 * constraint violation, re-fetch, return existing." This type exists only
 * so CustomerCacheUpserter can catch it internally; if it ever escapes
 * uncaught, that's a real bug worth a loud, generic 500, not a
 * misleadingly-specific mapped status code.
 */
export class CustomerPhoneAlreadyExistsError extends Error {
  constructor(
    public readonly businessId: string,
    public readonly phoneE164: string,
  ) {
    super(`Customer with phone ${phoneE164} already exists for business ${businessId}.`);
    this.name = "CustomerPhoneAlreadyExistsError";
  }
}
