import type { CrmCredential } from "../crm-credential";

export interface SearchCustomerInput {
  phoneE164: string;
}

export interface CreateCustomerInput {
  name: string;
  phoneE164: string;
  email?: string | undefined;
  address?: Record<string, unknown> | undefined;
}

export interface CustomerResult {
  crmCustomerId: string;
  name: string;
  phoneE164: string;
  email?: string | undefined;
  /** The vendor's raw response, cached verbatim (docs/06 `customers.crm_raw_cache`) — never parsed further than this adapter already has. */
  raw: unknown;
}

export interface CreateLeadInput {
  crmCustomerId: string;
  problemSummary: string;
  priority: string;
  leadType: string;
}

export interface UpdateLeadInput {
  status?: string | undefined;
}

export interface LeadResult {
  crmLeadId: string;
  status: string;
  raw: unknown;
}

/**
 * docs/05-crm-integration.md §1 class diagram, docs/14-backend-stack-and-code-standards.md
 * §3 (Interface Segregation) — split narrowly so a caller that only ever
 * needs customer lookups doesn't take on a dependency shaped like the full
 * adapter surface.
 */
export interface CustomerPort {
  /** Returns null on "not found" — never throws for a legitimate empty search result. */
  searchCustomerByPhone(
    credential: CrmCredential,
    input: SearchCustomerInput,
  ): Promise<CustomerResult | null>;
  createCustomer(credential: CrmCredential, input: CreateCustomerInput): Promise<CustomerResult>;
}

export interface LeadPort {
  /**
   * Per docs/05 §3's load-bearing contract: MUST NEVER cause a technician to
   * be dispatched or a calendar slot to be reserved. A conforming
   * implementation contains no code path that calls a job-creation,
   * job-scheduling, or dispatch endpoint under any circumstance — verified
   * by this module's adapter contract test suite, not just documented.
   */
  createLead(credential: CrmCredential, input: CreateLeadInput): Promise<LeadResult>;
  updateLead(
    credential: CrmCredential,
    crmLeadId: string,
    patch: UpdateLeadInput,
  ): Promise<LeadResult>;
}

export interface NotePort {
  attachNote(credential: CrmCredential, entityId: string, note: string): Promise<void>;
}

export interface CrmWebhookEvent {
  /**
   * A stable id for THIS delivery, for provider-event-id dedup (docs/01
   * §7's `webhook_events` table). Populated from the payload's own event
   * id when the vendor's envelope includes one; if not (or the exact shape
   * is unconfirmed, as HCP's is — docs/05 §2.6), a hash of the raw body is
   * an equally valid fallback: dedup only needs "have I seen this exact
   * delivery before," which a content hash answers correctly either way.
   */
  eventId: string;
  eventType: string;
  crmLeadId?: string | undefined;
  crmCustomerId?: string | undefined;
  raw: unknown;
}

/**
 * The full adapter surface every CRM (real or stub) implements. `crmType`
 * is a plain readonly property, not inferred from the class name, so the
 * registry (crm-adapter-registry.port.ts) can key on it without reflection.
 */
export interface CRMAdapter extends CustomerPort, LeadPort, NotePort {
  readonly crmType: string;

  /**
   * A lightweight, read-only call used to confirm stored credentials still
   * work — docs/15-tenant-lifecycle-billing-and-analytics.md §1's onboarding
   * "Verify connection" step ("test call: searchCustomer against a known
   * test record"), and re-usable afterward for periodic health checks.
   * Resolves on success; throws (CrmAuthenticationError or CrmAdapterError,
   * ../errors.ts) on any failure — never returns a boolean the caller has
   * to remember to check.
   */
  testConnection(credential: CrmCredential): Promise<void>;

  /**
   * Deliberately takes the raw header bag, not a single header value — per
   * docs/05 §2.6, the exact signature header name is itself one of the
   * must-verify-before-build unknowns (`x-housecall-signature` vs
   * `x-housecallpro-signature`), so each adapter owns which header(s) it
   * looks at rather than the webhook receiver hard-coding one.
   */
  verifyWebhookSignature(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string,
    signingSecret: string,
  ): boolean;

  /** Only ever called after verifyWebhookSignature has already returned true. */
  parseWebhookEvent(rawBody: string): CrmWebhookEvent;
}
