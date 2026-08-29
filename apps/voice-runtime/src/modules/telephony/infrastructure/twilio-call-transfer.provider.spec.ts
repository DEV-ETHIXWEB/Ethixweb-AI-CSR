import { TwilioCallTransferProvider } from "./twilio-call-transfer.provider";

/**
 * No live Twilio account in this environment to verify this class's actual
 * REST call against — the honest, structural next-best thing (this
 * provider's own comment says so too) is to verify the request THIS class
 * sends is exactly the shape Twilio's documented call-modification API
 * requires: right URL, HTTP Basic auth built from the two env vars, the
 * `Twiml` form param carrying a `<Dial>` to the given destination, and
 * that a non-2xx Twilio response surfaces as a thrown error rather than
 * being silently swallowed (a real emergency transfer failing silently
 * would be exactly the kind of bug this session has already found and
 * fixed elsewhere for the destination-number side of this same feature).
 */
describe("TwilioCallTransferProvider", () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  function withEnv(): void {
    process.env["TWILIO_ACCOUNT_SID"] = "AC_test_account_sid";
    process.env["TWILIO_AUTH_TOKEN"] = "test_auth_token";
  }

  it("POSTs Twilio's documented call-modification endpoint with Basic auth and a Twiml <Dial> to the destination", async () => {
    withEnv();
    const fetchSpy = jest.fn().mockResolvedValue(new Response(null, { status: 200 }));
    global.fetch = fetchSpy;

    const provider = new TwilioCallTransferProvider();
    await provider.transferCall("CA1234567890", "+15550009999");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://api.twilio.com/2010-04-01/Accounts/AC_test_account_sid/Calls/CA1234567890.json",
    );
    expect(init.method).toBe("POST");

    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe(
      `Basic ${Buffer.from("AC_test_account_sid:test_auth_token").toString("base64")}`,
    );
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");

    const body = new URLSearchParams(init.body as string);
    expect(body.get("Twiml")).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Dial>+15550009999</Dial></Response>',
    );
  });

  it("XML-escapes a destination containing reserved characters rather than emitting malformed TwiML", async () => {
    withEnv();
    const fetchSpy = jest.fn().mockResolvedValue(new Response(null, { status: 200 }));
    global.fetch = fetchSpy;

    const provider = new TwilioCallTransferProvider();
    await provider.transferCall("CA1", "sip:ops<team>@example.com");

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = new URLSearchParams(init.body as string);
    expect(body.get("Twiml")).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Dial>sip:ops&lt;team&gt;@example.com</Dial></Response>',
    );
  });

  it("throws, surfacing the response body, when Twilio returns a non-2xx status", async () => {
    withEnv();
    global.fetch = jest
      .fn()
      .mockResolvedValue(new Response("call not in-progress", { status: 400 }));

    const provider = new TwilioCallTransferProvider();

    await expect(provider.transferCall("CA1", "+15550009999")).rejects.toThrow(
      /Twilio call-transfer failed \(400\): call not in-progress/,
    );
  });

  it("throws immediately, without calling fetch, when TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN are not configured", async () => {
    delete process.env["TWILIO_ACCOUNT_SID"];
    delete process.env["TWILIO_AUTH_TOKEN"];
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy;

    const provider = new TwilioCallTransferProvider();

    await expect(provider.transferCall("CA1", "+15550009999")).rejects.toThrow(
      "TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN are not configured",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
