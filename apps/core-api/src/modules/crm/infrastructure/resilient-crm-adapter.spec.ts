import { CircuitBreaker, CircuitOpenError, RetryExhaustedError } from "@ethixweb/shared-kernel";
import { createNoopLogger } from "../application/__fakes__/fake-logger";
import { CrmAuthenticationError } from "../domain/errors";
import type { CRMAdapter } from "../domain/ports/crm-adapter.port";
import { ResilientCrmAdapter } from "./resilient-crm-adapter";

const CREDENTIAL = { type: "api_key" as const, apiKey: "k" };
const FAST_RETRY_OPTIONS = { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2, jitterRatio: 0 };

function buildInnerAdapter(overrides: Partial<CRMAdapter> = {}): CRMAdapter {
  return {
    crmType: "fake",
    searchCustomerByPhone: async () => null,
    createCustomer: async () => ({ crmCustomerId: "x", name: "x", phoneE164: "x", raw: {} }),
    createLead: async () => ({ crmLeadId: "x", status: "new", raw: {} }),
    updateLead: async () => ({ crmLeadId: "x", status: "x", raw: {} }),
    attachNote: async () => undefined,
    testConnection: async () => undefined,
    verifyWebhookSignature: () => true,
    parseWebhookEvent: () => ({ eventId: "x", eventType: "x", raw: {} }),
    ...overrides,
  };
}

describe("ResilientCrmAdapter", () => {
  it("passes through a successful call unchanged", async () => {
    const inner = buildInnerAdapter({ testConnection: async () => undefined });
    const resilient = new ResilientCrmAdapter(
      inner,
      new CircuitBreaker("test"),
      createNoopLogger(),
      FAST_RETRY_OPTIONS,
    );

    await expect(resilient.testConnection(CREDENTIAL)).resolves.toBeUndefined();
  });

  it("retries a transient failure and eventually succeeds", async () => {
    let attempts = 0;
    const inner = buildInnerAdapter({
      testConnection: async () => {
        attempts += 1;
        if (attempts < 2) {
          throw new Error("transient network blip");
        }
      },
    });
    const resilient = new ResilientCrmAdapter(
      inner,
      new CircuitBreaker("test"),
      createNoopLogger(),
      FAST_RETRY_OPTIONS,
    );

    await expect(resilient.testConnection(CREDENTIAL)).resolves.toBeUndefined();
    expect(attempts).toBe(2);
  });

  it("does NOT retry a CrmAuthenticationError — fails on the first attempt", async () => {
    let attempts = 0;
    const inner = buildInnerAdapter({
      testConnection: async () => {
        attempts += 1;
        throw new CrmAuthenticationError("fake", "bad key");
      },
    });
    const resilient = new ResilientCrmAdapter(
      inner,
      new CircuitBreaker("test"),
      createNoopLogger(),
      FAST_RETRY_OPTIONS,
    );

    await expect(resilient.testConnection(CREDENTIAL)).rejects.toThrow(CrmAuthenticationError);
    expect(attempts).toBe(1);
  });

  it("exhausts retries and surfaces RetryExhaustedError for a persistent transient failure", async () => {
    const inner = buildInnerAdapter({
      testConnection: async () => {
        throw new Error("always fails");
      },
    });
    const resilient = new ResilientCrmAdapter(
      inner,
      new CircuitBreaker("test", { failureThreshold: 100 }), // high enough the breaker itself doesn't open first
      createNoopLogger(),
      FAST_RETRY_OPTIONS,
    );

    await expect(resilient.testConnection(CREDENTIAL)).rejects.toThrow(RetryExhaustedError);
  });

  it("opens the circuit after consecutive failures and rejects further calls with CircuitOpenError", async () => {
    const inner = buildInnerAdapter({
      testConnection: async () => {
        throw new Error("down");
      },
    });
    const circuitBreaker = new CircuitBreaker("test", { failureThreshold: 1 });
    const resilient = new ResilientCrmAdapter(inner, circuitBreaker, createNoopLogger(), {
      maxAttempts: 1, // one attempt per call, so each call trips the breaker's failure count directly
    });

    await expect(resilient.testConnection(CREDENTIAL)).rejects.toThrow();
    // The breaker is now open (1 failure >= failureThreshold of 1) — a
    // second call must fail fast with CircuitOpenError, never even
    // attempting the inner adapter.
    await expect(resilient.testConnection(CREDENTIAL)).rejects.toThrow(CircuitOpenError);
  });

  it("verifyWebhookSignature and parseWebhookEvent pass through directly, uninstrumented (no retry/circuit breaker)", () => {
    const inner = buildInnerAdapter({
      verifyWebhookSignature: () => true,
      parseWebhookEvent: () => ({ eventId: "e1", eventType: "lead.created", raw: {} }),
    });
    const resilient = new ResilientCrmAdapter(
      inner,
      new CircuitBreaker("test"),
      createNoopLogger(),
    );

    expect(resilient.verifyWebhookSignature({}, "{}", "secret")).toBe(true);
    expect(resilient.parseWebhookEvent("{}")).toEqual({
      eventId: "e1",
      eventType: "lead.created",
      raw: {},
    });
  });
});
