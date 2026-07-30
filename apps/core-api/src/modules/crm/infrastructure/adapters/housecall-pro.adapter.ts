import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { verifyHmacSignature } from "../../../../shared/webhooks/hmac-signature.util";
import { CrmAdapterError, CrmAuthenticationError } from "../../domain/errors";
import type { CrmCredential } from "../../domain/crm-credential";
import type {
  CRMAdapter,
  CreateCustomerInput,
  CreateLeadInput,
  CrmWebhookEvent,
  CustomerResult,
  LeadResult,
  SearchCustomerInput,
} from "../../domain/ports/crm-adapter.port";

const DEFAULT_BASE_URL = process.env["HOUSECALL_PRO_API_BASE_URL"];
const PAGE_SIZE = 50;
const MAX_PAGES_SCANNED = 20; // bounds the client-side phone-search fallback below at 1000 customers scanned

// [UNVERIFIED] docs/05-crm-integration.md §2.6: two independent sources
// disagree on the exact signature header name, and neither is confirmed —
// checked in the order listed, first present wins. MUST be confirmed
// against a live sandbox webhook delivery before this adapter is trusted
// in production (docs/05 §2.9 item 5).
const CANDIDATE_SIGNATURE_HEADERS = ["x-housecall-signature", "x-housecallpro-signature"];

interface HcpCustomerRow {
  id: string;
  first_name?: string;
  last_name?: string;
  mobile_number?: string;
  email?: string;
}

/**
 * Implements CRMAdapter against Housecall Pro's Public API, researched
 * directly in docs/05-crm-integration.md §2 (July 2026). Every method below
 * is tagged in its own comment as resting on either a **[Confirmed]**
 * endpoint (verified against HCP's own docs nav/Help Center) or an
 * **[Unverified]** request/response shape (a reconstructed, uncorroborated
 * spec) — carrying that same distinction from the research doc into the
 * code itself, rather than letting an unverified guess read as settled fact
 * once it's implemented. `updateLead` and `attachNote` have no confirmed
 * endpoint at all and deliberately throw rather than call something that
 * might not exist — see docs/05 §2.9's must-verify-before-build list and
 * docs/13-implementation-backlog.md crm-integration module task 0.
 */
@Injectable()
export class HousecallProAdapter implements CRMAdapter {
  readonly crmType = "housecall_pro";

  async searchCustomerByPhone(
    credential: CrmCredential,
    input: SearchCustomerInput,
  ): Promise<CustomerResult | null> {
    // [Unverified] whether GET /customers supports a server-side phone
    // filter param (docs/05 §2.2, §2.9 item 2) — using the documented safe
    // fallback instead: page through GET /customers and match client-side.
    // Replace with a server-side filter once the real param is confirmed;
    // viable at typical single-business customer-list sizes per that
    // section's own note.
    for (let page = 1; page <= MAX_PAGES_SCANNED; page++) {
      const body = await this.request<{ customers: HcpCustomerRow[] }>(
        credential,
        "GET",
        `/customers?page=${page}&page_size=${PAGE_SIZE}`,
      );
      const rows = body.customers ?? [];
      const match = rows.find((row) => row.mobile_number === input.phoneE164);
      if (match) {
        return this.toCustomerResult(match);
      }
      if (rows.length < PAGE_SIZE) {
        break; // last page
      }
    }
    return null;
  }

  async createCustomer(
    credential: CrmCredential,
    input: CreateCustomerInput,
  ): Promise<CustomerResult> {
    // [Unverified] exact field names (docs/05 §2.2) — best-effort split of
    // `name` into first/last, the reasonable starting hypothesis the
    // research doc itself proposes.
    const [firstName, ...rest] = input.name.trim().split(/\s+/);
    const lastName = rest.join(" ") || undefined;
    const row = await this.request<HcpCustomerRow>(credential, "POST", "/customers", {
      first_name: firstName,
      last_name: lastName,
      mobile_number: input.phoneE164,
      email: input.email,
    });
    return this.toCustomerResult(row);
  }

  async createLead(credential: CrmCredential, input: CreateLeadInput): Promise<LeadResult> {
    // [Confirmed] POST /leads is HCP's genuine, separate Lead resource
    // (docs/05 §2.3) — never Create a Job. [Unverified] the exact request
    // schema (whether customer_id is required inline, notes field name).
    const row = await this.request<{ id: string; status?: string }>(credential, "POST", "/leads", {
      customer_id: input.crmCustomerId,
      notes: input.problemSummary,
    });
    return { crmLeadId: row.id, status: row.status ?? "new", raw: row };
  }

  // `async` here isn't decorative — it's what turns this synchronous throw
  // into a rejected promise, matching the CRMAdapter interface's contract
  // (every method returns a Promise) rather than throwing synchronously out
  // of a non-async function, which would surprise a caller that reasonably
  // expects to `await` and `.catch()` this like every other adapter method.
  async updateLead(): Promise<LeadResult> {
    throw new CrmAdapterError(
      this.crmType,
      "updateLead",
      "No confirmed Housecall Pro API endpoint for updating a Lead was found in public docs " +
        "(docs/05-crm-integration.md §2.3) — do not call until confirmed against a live sandbox " +
        "(docs/13-implementation-backlog.md crm-integration module task 0).",
    );
  }

  async attachNote(): Promise<void> {
    throw new CrmAdapterError(
      this.crmType,
      "attachNote",
      "Whether the Lead object has a note/tag/attachment endpoint is unconfirmed " +
        "(docs/05-crm-integration.md §2.5) — pass qualification context via createLead's own " +
        "notes field instead; once converted to a Job, the confirmed 'Add job note' endpoint " +
        "applies, which is a job-level operation this adapter deliberately never calls (docs/05 §3).",
    );
  }

  async testConnection(credential: CrmCredential): Promise<void> {
    // A minimal, cheap, read-only call — confirms the stored credential is
    // still accepted without depending on any customer data existing.
    await this.request(credential, "GET", "/customers?page=1&page_size=1");
  }

  verifyWebhookSignature(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string,
    signingSecret: string,
  ): boolean {
    for (const headerName of CANDIDATE_SIGNATURE_HEADERS) {
      const value = headers[headerName];
      const signature = Array.isArray(value) ? value[0] : value;
      if (typeof signature === "string" && signature.length > 0) {
        return verifyHmacSignature(rawBody, signature, signingSecret, "sha256");
      }
    }
    return false;
  }

  parseWebhookEvent(rawBody: string): CrmWebhookEvent {
    // [Unverified] exact envelope shape — best-effort `{ event, id, data: { id, ... } }`
    // pending live-sandbox confirmation (docs/05 §2.6). Falls back to a
    // content hash for eventId when no explicit id field is present — see
    // CrmWebhookEvent's own comment on why that's still correct for dedup.
    const parsed = JSON.parse(rawBody) as { event?: string; id?: string; data?: { id?: string } };
    const eventId = parsed.id ?? createHash("sha256").update(rawBody).digest("hex");
    return {
      eventId,
      eventType: parsed.event ?? "unknown",
      crmLeadId: parsed.data?.id,
      raw: parsed,
    };
  }

  private toCustomerResult(row: HcpCustomerRow): CustomerResult {
    const name = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
    return {
      crmCustomerId: row.id,
      name,
      phoneE164: row.mobile_number ?? "",
      email: row.email,
      raw: row,
    };
  }

  private async request<T>(
    credential: CrmCredential,
    method: "GET" | "POST" | "PUT",
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    if (credential.type !== "api_key") {
      // [Confirmed] docs/05 §2.1: the primary, documented HCP auth path is
      // a static Admin-issued API key — OAuth2/the Partner Jobs API's exact
      // applicability is one of the unresolved must-verify items, so this
      // adapter only supports the confirmed path.
      throw new CrmAuthenticationError(
        this.crmType,
        "only api_key credentials are supported (OAuth2/Partner Jobs API path unconfirmed, docs/05 §2.1)",
      );
    }
    const baseUrl = credential.baseUrl ?? DEFAULT_BASE_URL;
    if (!baseUrl) {
      throw new CrmAdapterError(
        this.crmType,
        "request",
        "no base URL configured (set HOUSECALL_PRO_API_BASE_URL, or per-integration credential.baseUrl)",
      );
    }

    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${credential.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: body ? JSON.stringify(body) : null,
      });
    } catch (error) {
      throw new CrmAdapterError(
        this.crmType,
        path,
        `network error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new CrmAuthenticationError(this.crmType, `HTTP ${response.status} from ${path}`);
    }
    if (!response.ok) {
      throw new CrmAdapterError(this.crmType, path, `HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  }
}
