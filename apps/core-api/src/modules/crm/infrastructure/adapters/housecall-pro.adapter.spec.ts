import { createHmac } from "node:crypto";
import { CrmAdapterError, CrmAuthenticationError } from "../../domain/errors";
import type { CRMAdapter } from "../../domain/ports/crm-adapter.port";
import { HousecallProAdapter } from "./housecall-pro.adapter";

const CREDENTIAL = {
  type: "api_key" as const,
  apiKey: "test-key",
  baseUrl: "https://hcp.example.test",
};

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("HousecallProAdapter", () => {
  let fetchMock: jest.Mock;
  // Typed as the interface, not the concrete class — updateLead/attachNote
  // deliberately have a narrower concrete signature (0 params) than the
  // interface they implement (see housecall-pro.adapter.ts's own comment),
  // so calling them with realistic interface-shaped args in these tests
  // needs the interface type, the same way any other caller would use it.
  let adapter: CRMAdapter;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    adapter = new HousecallProAdapter();
  });

  describe("searchCustomerByPhone", () => {
    it("finds a match on the first page and stops paging", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, {
          customers: [
            { id: "cust-1", first_name: "Jane", last_name: "Doe", mobile_number: "+15551234567" },
          ],
        }),
      );

      const result = await adapter.searchCustomerByPhone(CREDENTIAL, { phoneE164: "+15551234567" });

      expect(result?.crmCustomerId).toBe("cust-1");
      expect(result?.name).toBe("Jane Doe");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("returns null when the last (short) page has no match", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, { customers: [{ id: "cust-2", mobile_number: "+15550000000" }] }),
      );

      const result = await adapter.searchCustomerByPhone(CREDENTIAL, { phoneE164: "+15551234567" });

      expect(result).toBeNull();
    });
  });

  it("createCustomer posts to /customers with a best-effort mapped body", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, {
        id: "cust-new",
        first_name: "Jane",
        last_name: "Doe",
        mobile_number: "+15551234567",
      }),
    );

    const result = await adapter.createCustomer(CREDENTIAL, {
      name: "Jane Doe",
      phoneE164: "+15551234567",
    });

    expect(result.crmCustomerId).toBe("cust-new");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/customers");
    expect(JSON.parse(init.body as string)).toMatchObject({ first_name: "Jane", last_name: "Doe" });
  });

  describe("createLead — safety contract", () => {
    it("posts to /leads and never calls any job/schedule/dispatch-shaped URL", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(201, { id: "lead-1", status: "new" }));

      const result = await adapter.createLead(CREDENTIAL, {
        crmCustomerId: "cust-1",
        problemSummary: "Leaking pipe",
        priority: "normal",
        leadType: "service_call",
      });

      expect(result.crmLeadId).toBe("lead-1");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("/leads");
      // The load-bearing assertion: across every fetch call this adapter
      // ever made in this test, none touched a job/schedule/dispatch
      // endpoint — docs/05-crm-integration.md §3's contract.
      for (const call of fetchMock.mock.calls as [string, RequestInit][]) {
        expect(call[0]).not.toMatch(/\/jobs|schedule|dispatch/i);
      }
    });
  });

  it("updateLead throws CrmAdapterError — no confirmed HCP endpoint exists", async () => {
    await expect(adapter.updateLead(CREDENTIAL, "lead-1", { status: "won" })).rejects.toThrow(
      CrmAdapterError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("attachNote throws CrmAdapterError — Lead note support is unconfirmed", async () => {
    await expect(adapter.attachNote(CREDENTIAL, "lead-1", "note text")).rejects.toThrow(
      CrmAdapterError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe("testConnection", () => {
    it("resolves on a successful call", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { customers: [] }));
      await expect(adapter.testConnection(CREDENTIAL)).resolves.toBeUndefined();
    });

    it("throws CrmAuthenticationError on a 401", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: "unauthorized" }));
      await expect(adapter.testConnection(CREDENTIAL)).rejects.toThrow(CrmAuthenticationError);
    });
  });

  describe("verifyWebhookSignature", () => {
    const secret = "whsec_test";
    const rawBody = JSON.stringify({ event: "lead.created" });
    const validSignature = createHmac("sha256", secret).update(rawBody).digest("hex");

    it("verifies using the x-housecall-signature header", () => {
      expect(
        adapter.verifyWebhookSignature(
          { "x-housecall-signature": validSignature },
          rawBody,
          secret,
        ),
      ).toBe(true);
    });

    it("verifies using the x-housecallpro-signature header (the other candidate)", () => {
      expect(
        adapter.verifyWebhookSignature(
          { "x-housecallpro-signature": validSignature },
          rawBody,
          secret,
        ),
      ).toBe(true);
    });

    it("rejects an invalid signature", () => {
      expect(
        adapter.verifyWebhookSignature(
          { "x-housecall-signature": "0".repeat(64) },
          rawBody,
          secret,
        ),
      ).toBe(false);
    });

    it("rejects when neither candidate header is present", () => {
      expect(adapter.verifyWebhookSignature({}, rawBody, secret)).toBe(false);
    });
  });

  describe("parseWebhookEvent", () => {
    it("extracts eventType and crmLeadId from a well-formed payload", () => {
      const event = adapter.parseWebhookEvent(
        JSON.stringify({ event: "lead.converted", id: "evt-1", data: { id: "lead-1" } }),
      );
      expect(event).toMatchObject({
        eventId: "evt-1",
        eventType: "lead.converted",
        crmLeadId: "lead-1",
      });
    });

    it("falls back to a content hash for eventId when no explicit id is present", () => {
      const rawBody = JSON.stringify({ event: "lead.created", data: { id: "lead-2" } });
      const event = adapter.parseWebhookEvent(rawBody);
      expect(event.eventId).toHaveLength(64); // sha256 hex digest length
      expect(event.eventType).toBe("lead.created");
    });
  });
});
