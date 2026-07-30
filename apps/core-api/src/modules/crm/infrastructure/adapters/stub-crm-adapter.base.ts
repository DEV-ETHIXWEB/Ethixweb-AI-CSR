import { CrmAdapterNotImplementedError } from "../../domain/errors";
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
import type { CrmCredential } from "../../domain/crm-credential";

/**
 * docs/13-implementation-backlog.md crm-integration module §7: "Stub
 * adapter interfaces... interface + a 'not yet implemented' throwing stub —
 * proves the interface is genuinely CRM-agnostic before a second real
 * implementation is built." Every method throws rather than silently
 * no-op-ing or returning a fake result, so a caller can never mistake "not
 * built yet" for "built, and it did nothing" — the same discipline as a
 * `NotImplementedError` in any language, applied consistently across all
 * four not-yet-built CRMs rather than reimplemented per adapter.
 */
export abstract class StubCrmAdapter implements CRMAdapter {
  abstract readonly crmType: string;

  async searchCustomerByPhone(
    _credential: CrmCredential,
    _input: SearchCustomerInput,
  ): Promise<CustomerResult | null> {
    throw this.notImplemented("searchCustomerByPhone");
  }

  async createCustomer(
    _credential: CrmCredential,
    _input: CreateCustomerInput,
  ): Promise<CustomerResult> {
    throw this.notImplemented("createCustomer");
  }

  async createLead(_credential: CrmCredential, _input: CreateLeadInput): Promise<LeadResult> {
    throw this.notImplemented("createLead");
  }

  async updateLead(
    _credential: CrmCredential,
    _crmLeadId: string,
    _patch: UpdateLeadInput,
  ): Promise<LeadResult> {
    throw this.notImplemented("updateLead");
  }

  async attachNote(_credential: CrmCredential, _entityId: string, _note: string): Promise<void> {
    throw this.notImplemented("attachNote");
  }

  async testConnection(_credential: CrmCredential): Promise<void> {
    throw this.notImplemented("testConnection");
  }

  verifyWebhookSignature(
    _headers: Record<string, string | string[] | undefined>,
    _rawBody: string,
    _signingSecret: string,
  ): boolean {
    throw this.notImplemented("verifyWebhookSignature");
  }

  parseWebhookEvent(_rawBody: string): CrmWebhookEvent {
    throw this.notImplemented("parseWebhookEvent");
  }

  private notImplemented(operation: string): CrmAdapterNotImplementedError {
    return new CrmAdapterNotImplementedError(this.crmType, operation);
  }
}
