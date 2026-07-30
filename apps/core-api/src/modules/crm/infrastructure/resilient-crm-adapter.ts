import {
  withRetry,
  type CircuitBreaker,
  type RetryPolicyOptions,
  type StructuredLogger,
} from "@ethixweb/shared-kernel";
import { CrmAuthenticationError } from "../domain/errors";
import type { CrmCredential } from "../domain/crm-credential";
import type {
  CRMAdapter,
  CreateCustomerInput,
  CreateLeadInput,
  CrmWebhookEvent,
  CustomerResult,
  LeadResult,
  SearchCustomerInput,
  UpdateLeadInput,
} from "../domain/ports/crm-adapter.port";

/**
 * Wraps any CRMAdapter with the circuit breaker + retry/timeout policy
 * docs/05-crm-integration.md §1 requires uniformly for every adapter method
 * — infrastructure the interface provides once here, not something each
 * vendor adapter (HousecallProAdapter, a future ServiceTitanAdapter, ...)
 * reimplements. Only the network-calling methods are wrapped;
 * verifyWebhookSignature/parseWebhookEvent are synchronous, local, and
 * never touch the network, so wrapping them would add nothing.
 */
export class ResilientCrmAdapter implements CRMAdapter {
  constructor(
    private readonly inner: CRMAdapter,
    private readonly circuitBreaker: CircuitBreaker,
    private readonly logger: StructuredLogger,
    // Overridable so tests can exercise real retry behavior without real
    // multi-second delays — production callers (crm-adapter-registry.ts)
    // rely on shared-kernel's own platform-wide defaults by omitting this.
    private readonly retryOptions: RetryPolicyOptions = {},
  ) {}

  get crmType(): string {
    return this.inner.crmType;
  }

  async searchCustomerByPhone(
    credential: CrmCredential,
    input: SearchCustomerInput,
  ): Promise<CustomerResult | null> {
    return this.resilient("searchCustomerByPhone", () =>
      this.inner.searchCustomerByPhone(credential, input),
    );
  }

  async createCustomer(
    credential: CrmCredential,
    input: CreateCustomerInput,
  ): Promise<CustomerResult> {
    return this.resilient("createCustomer", () => this.inner.createCustomer(credential, input));
  }

  async createLead(credential: CrmCredential, input: CreateLeadInput): Promise<LeadResult> {
    return this.resilient("createLead", () => this.inner.createLead(credential, input));
  }

  async updateLead(
    credential: CrmCredential,
    crmLeadId: string,
    patch: UpdateLeadInput,
  ): Promise<LeadResult> {
    return this.resilient("updateLead", () => this.inner.updateLead(credential, crmLeadId, patch));
  }

  async attachNote(credential: CrmCredential, entityId: string, note: string): Promise<void> {
    return this.resilient("attachNote", () => this.inner.attachNote(credential, entityId, note));
  }

  async testConnection(credential: CrmCredential): Promise<void> {
    return this.resilient("testConnection", () => this.inner.testConnection(credential));
  }

  verifyWebhookSignature(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string,
    signingSecret: string,
  ): boolean {
    return this.inner.verifyWebhookSignature(headers, rawBody, signingSecret);
  }

  parseWebhookEvent(rawBody: string): CrmWebhookEvent {
    return this.inner.parseWebhookEvent(rawBody);
  }

  private async resilient<T>(operation: string, work: () => Promise<T>): Promise<T> {
    return this.circuitBreaker.execute(() =>
      withRetry(work, {
        ...this.retryOptions,
        // A bad credential fails the same way every time — retrying it 6x
        // just burns the CRM's rate-limit budget and delays the caller for
        // no benefit. Every other failure (network blip, 5xx, timeout) is
        // exactly the transient case retry exists for.
        isRetryable: (error) => !(error instanceof CrmAuthenticationError),
        onRetry: (attempt, delayMs) => {
          this.logger.warn("CRM adapter operation retrying", {
            crmType: this.inner.crmType,
            operation,
            attempt,
            delayMs,
          });
        },
      }),
    );
  }
}
