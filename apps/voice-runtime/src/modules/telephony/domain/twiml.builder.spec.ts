import { buildApologyTwiml, buildConnectStreamTwiml, buildDialHumanTwiml } from "./twiml.builder";

describe("twiml.builder", () => {
  describe("buildConnectStreamTwiml", () => {
    it("produces a <Connect><Stream> pointed at the websocket URL, carrying every callParameter as a Stream <Parameter>", () => {
      const twiml = buildConnectStreamTwiml({
        websocketUrl: "wss://runtime.example.com/media-stream",
        callParameters: {
          callId: "11111111-1111-1111-1111-111111111111",
          tenantId: "tenant-1",
          businessId: "business-1",
          callerAni: "+15551234567",
        },
      });

      expect(twiml).toContain("<Connect>");
      expect(twiml).toContain('<Stream url="wss://runtime.example.com/media-stream">');
      expect(twiml).toContain(
        '<Parameter name="callId" value="11111111-1111-1111-1111-111111111111" />',
      );
      expect(twiml).toContain('<Parameter name="tenantId" value="tenant-1" />');
      expect(twiml).not.toContain("<Start>");
    });

    it("XML-escapes special characters in the URL and parameter values", () => {
      const twiml = buildConnectStreamTwiml({
        websocketUrl: "wss://runtime.example.com/media-stream?x=1&y=2",
        callParameters: { callId: "call<1>" },
      });

      expect(twiml).toContain("&amp;");
      expect(twiml).toContain("call&lt;1&gt;");
      expect(twiml).not.toContain("call<1>");
    });
  });

  describe("buildDialHumanTwiml", () => {
    it("produces a <Dial> straight to the given number, with no <Connect>/<Stream> at all", () => {
      const twiml = buildDialHumanTwiml("+15559998877");

      expect(twiml).toContain("<Dial>+15559998877</Dial>");
      expect(twiml).not.toContain("<Connect>");
      expect(twiml).not.toContain("<Stream");
    });

    it("XML-escapes the destination", () => {
      const twiml = buildDialHumanTwiml("+1555<evil>");

      expect(twiml).toContain("+1555&lt;evil&gt;");
      expect(twiml).not.toContain("<evil>");
    });
  });

  describe("buildApologyTwiml", () => {
    it("produces a <Say> + <Hangup> fallback with no dependency on any other service", () => {
      const twiml = buildApologyTwiml();

      expect(twiml).toContain("<Say>");
      expect(twiml).toContain("<Hangup/>");
    });
  });
});
