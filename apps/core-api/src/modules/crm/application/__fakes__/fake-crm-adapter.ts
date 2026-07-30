import type { CrmCredential } from "../../domain/crm-credential";
import type {
  CRMAdapter,
  CreateCustomerInput,
  CreateLeadInput,
  CrmWebhookEvent,
  CustomerResult,
  LeadResult,
  SearchCustomerInput,
  UpdateLeadInput,
} from "../../domain/ports/crm-adapter.port";

/**
 * A fully-implemented, in-memory CRMAdapter — used both to test use-cases
 * in isolation from any real vendor, and as the reference implementation
 * the adapter conformance test suite (crm-adapter-contract.spec.ts) runs
 * against to prove the interface itself is coherent.
 */
export class FakeCrmAdapter implements CRMAdapter {
  readonly crmType = "fake";

  private readonly customersByPhone = new Map<string, CustomerResult>();
  private nextCustomerId = 1;
  private nextLeadId = 1;
  public testConnectionShouldFail = false;
  public readonly createLeadCalls: CreateLeadInput[] = [];

  async searchCustomerByPhone(
    _credential: CrmCredential,
    input: SearchCustomerInput,
  ): Promise<CustomerResult | null> {
    return this.customersByPhone.get(input.phoneE164) ?? null;
  }

  async createCustomer(
    _credential: CrmCredential,
    input: CreateCustomerInput,
  ): Promise<CustomerResult> {
    const result: CustomerResult = {
      crmCustomerId: `fake-customer-${this.nextCustomerId++}`,
      name: input.name,
      phoneE164: input.phoneE164,
      email: input.email,
      raw: { ...input },
    };
    this.customersByPhone.set(input.phoneE164, result);
    return result;
  }

  async createLead(_credential: CrmCredential, input: CreateLeadInput): Promise<LeadResult> {
    // Recorded so the contract test can assert this method never touches
    // anything job/schedule-shaped — a fake has no HTTP client to spy on,
    // so the assertion instead is: the fake NEVER exposes a job-creation
    // method at all, and this call list is the only side effect recorded.
    this.createLeadCalls.push(input);
    return { crmLeadId: `fake-lead-${this.nextLeadId++}`, status: "new", raw: { ...input } };
  }

  async updateLead(
    _credential: CrmCredential,
    crmLeadId: string,
    patch: UpdateLeadInput,
  ): Promise<LeadResult> {
    return { crmLeadId, status: patch.status ?? "new", raw: { ...patch } };
  }

  async attachNote(_credential: CrmCredential, _entityId: string, _note: string): Promise<void> {
    // no-op — nothing to assert on beyond "didn't throw"
  }

  async testConnection(_credential: CrmCredential): Promise<void> {
    if (this.testConnectionShouldFail) {
      throw new Error("fake connection test failure");
    }
  }

  verifyWebhookSignature(
    _headers: Record<string, string | string[] | undefined>,
    rawBody: string,
    signingSecret: string,
  ): boolean {
    return rawBody.includes(signingSecret);
  }

  parseWebhookEvent(rawBody: string): CrmWebhookEvent {
    const parsed = JSON.parse(rawBody) as {
      eventId?: string;
      eventType?: string;
      crmLeadId?: string;
    };
    return {
      eventId: parsed.eventId ?? "fake-event-id",
      eventType: parsed.eventType ?? "lead.created",
      crmLeadId: parsed.crmLeadId,
      raw: parsed,
    };
  }

  /** Test helper — seed a searchable customer directly. */
  seedCustomer(result: CustomerResult): void {
    this.customersByPhone.set(result.phoneE164, result);
  }
}
