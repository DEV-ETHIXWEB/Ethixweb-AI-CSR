import { ToolHandlerError } from "../domain/tool-definition";
import { HttpCoreApiClient } from "./http-core-api-client";

/**
 * Regression coverage for a real bug found live: this client's fetch()
 * call had no timeout at all, and Node's native fetch has none by
 * default. Every caller (every tool handler, capacity-config,
 * prompt-assembly's AI-knowledge fetch, and the Call-row creation
 * StartConversationUseCase/EndConversationUseCase make directly) sits on
 * the live-call path. Reproduced live: pointed this client at a server
 * that accepts the connection but never responds, then fired a real
 * POST /v1/conversations, it hung for 60+ seconds with zero response,
 * meaning a real caller would sit in dead air indefinitely. These tests
 * never make a real network call: fetch is mocked to control exactly
 * when/how it resolves or rejects.
 */
describe("HttpCoreApiClient", () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env["CORE_API_BASE_URL"] = "http://core-api.invalid/v1";
    process.env["CORE_API_SERVICE_API_KEY"] = "test-service-key";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  it("sends the API key header and returns the parsed JSON body on a successful GET", async () => {
    const fetchSpy = jest
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    global.fetch = fetchSpy;
    const client = new HttpCoreApiClient();

    const result = await client.get<{ ok: boolean }>("/internal/customers/1");

    expect(result).toEqual({ ok: true });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://core-api.invalid/v1/internal/customers/1");
    expect((init.headers as Record<string, string>)["X-Api-Key"]).toBe("test-service-key");
  });

  it("passes an AbortSignal with every request so a request that never resolves is still bounded, not left to hang forever", async () => {
    const fetchSpy = jest.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    global.fetch = fetchSpy;
    const client = new HttpCoreApiClient();

    await client.get("/internal/customers/1");

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("throws a retryable ToolHandlerError, not an uncaught rejection, when the underlying fetch times out", async () => {
    const timeoutError = new DOMException("The operation was aborted.", "TimeoutError");
    global.fetch = jest.fn().mockRejectedValue(timeoutError);
    const client = new HttpCoreApiClient();

    await expect(client.get("/internal/customers/1")).rejects.toMatchObject({
      name: "ToolHandlerError",
      retryable: true,
    });
    await expect(client.get("/internal/customers/1")).rejects.toThrow(/timed out after 5000ms/);
  });

  it("throws a retryable ToolHandlerError for a network-level failure (connection refused), same shape as a timeout", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("connect ECONNREFUSED"));
    const client = new HttpCoreApiClient();

    await expect(client.get("/internal/customers/1")).rejects.toBeInstanceOf(ToolHandlerError);
    await expect(client.get("/internal/customers/1")).rejects.toMatchObject({ retryable: true });
  });

  it("throws a retryable ToolHandlerError for a 500 response, non-retryable for a 400", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(new Response("server error", { status: 500 }))
      .mockResolvedValueOnce(new Response("bad request", { status: 400 }));
    const client = new HttpCoreApiClient();

    await expect(client.get("/x")).rejects.toMatchObject({ retryable: true });
    await expect(client.get("/x")).rejects.toMatchObject({ retryable: false });
  });

  it("throws a non-retryable ToolHandlerError immediately, without calling fetch, when CORE_API_SERVICE_API_KEY is not configured", async () => {
    delete process.env["CORE_API_SERVICE_API_KEY"];
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy;
    const client = new HttpCoreApiClient();

    await expect(client.get("/x")).rejects.toMatchObject({ retryable: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
