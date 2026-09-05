import { EventEmitter } from "node:events";
import type { ModuleRef } from "@nestjs/core";
import { MediaStreamGateway } from "./media-stream.gateway";
import { createNoopLogger } from "./__fakes__/fake-logger";
import { signMediaStreamParams } from "../infrastructure/media-stream-auth.util";

const TEST_AUTH_TOKEN = "test-auth-token";

class FakeSocket extends EventEmitter {
  sent: unknown[] = [];
  send(data: unknown): void {
    this.sent.push(data);
  }
  close(): void {
    this.emit("close");
  }
}

function buildFakeOrchestrator() {
  return {
    onCallStart: jest.fn().mockResolvedValue(undefined),
    onAudioFrame: jest.fn(),
    onCallEnd: jest.fn().mockResolvedValue(undefined),
  };
}

/**
 * `register()` hands Fastify's `.get(path, opts, handler)` a `handler`
 * that is `MediaStreamGateway`'s own `private async handleConnection` —
 * it `await`s `moduleRef.resolve(...)` before ever attaching its
 * `socket.on("message", ...)` listener, so a caller must await that
 * connection setup complete (a microtask flush is enough, since the fake
 * moduleRef below resolves synchronously-fast) before emitting messages,
 * exactly as a real Fastify/`ws` upgrade would only start delivering
 * "message" events once the handler has actually run.
 */
async function connect(
  orchestrator: ReturnType<typeof buildFakeOrchestrator>,
): Promise<FakeSocket> {
  const moduleRef = { resolve: async () => orchestrator } as unknown as ModuleRef;
  const gateway = new MediaStreamGateway(moduleRef, createNoopLogger());
  const socket = new FakeSocket();
  let connected: Promise<void> = Promise.resolve();
  gateway.register({
    get: (_path: string, _opts: unknown, handler: (conn: unknown) => Promise<void>) => {
      connected = handler({ socket });
    },
  } as never);
  await connected;
  return socket;
}

/**
 * Twilio's documented `start` event shape — same customParameters this
 * gateway's own `register()` reads. Includes a genuinely valid
 * `mediaStreamToken` by default (see media-stream-auth.util.ts) — every
 * caller of this helper besides the auth-rejection tests themselves needs
 * a connection that actually PASSES authentication to test anything
 * downstream of it; passing `overrides` that omit or corrupt the token is
 * how the rejection tests exercise the failure path.
 */
function startMessage(overrides: Record<string, string> = {}) {
  const baseParams = {
    callId: "call-1",
    tenantId: "tenant-1",
    businessId: "business-1",
    callerAni: "+15551234567",
    toNumber: "",
    timezone: "",
  };
  const mediaStreamToken = signMediaStreamParams(baseParams, TEST_AUTH_TOKEN);
  return JSON.stringify({
    event: "start",
    start: {
      streamSid: "MZxxxx",
      callSid: "CAxxxx",
      accountSid: "ACxxxx",
      customParameters: { ...baseParams, mediaStreamToken, ...overrides },
    },
  });
}

function mediaMessage(track: "inbound" | "outbound" | undefined, payload = "YWJj") {
  return JSON.stringify({
    event: "media",
    streamSid: "MZxxxx",
    media: { payload, ...(track ? { track } : {}) },
  });
}

/**
 * Regression coverage for the most serious bug found running a real live
 * call: a bidirectional `<Connect><Stream>` echoes back everything this
 * service sends the caller as its own "outbound"-track media event, on
 * the SAME channel as the caller's real "inbound" audio — verified
 * against Twilio's own Media Streams docs. This gateway previously
 * forwarded every "media" event to the STT pipeline unfiltered, which
 * fed the AI's own TTS output back into its own speech recognition for
 * the entire call — Deepgram's VAD correctly detected near-constant
 * "speech" (real audio energy, half of it the AI's own voice) but could
 * never produce a coherent transcript from audio that was actually the
 * caller and the AI talking over each other. This is what surfaced live
 * as "no response for 30-40 seconds" — not a timeout, a self-poisoned
 * transcript that only occasionally resolved to real text by chance.
 */
describe("MediaStreamGateway — inbound/outbound track filtering", () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env["TWILIO_AUTH_TOKEN"] = TEST_AUTH_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("forwards an inbound-track media event to the STT pipeline", async () => {
    const orchestrator = buildFakeOrchestrator();
    const socket = await connect(orchestrator);

    socket.emit("message", Buffer.from(startMessage()));
    socket.emit("message", Buffer.from(mediaMessage("inbound")));

    expect(orchestrator.onAudioFrame).toHaveBeenCalledTimes(1);
  });

  it("does NOT forward an outbound-track media event (the AI's own echoed TTS) to the STT pipeline", async () => {
    const orchestrator = buildFakeOrchestrator();
    const socket = await connect(orchestrator);

    socket.emit("message", Buffer.from(startMessage()));
    socket.emit("message", Buffer.from(mediaMessage("outbound")));

    expect(orchestrator.onAudioFrame).not.toHaveBeenCalled();
  });

  it("filters correctly across a mixed sequence of inbound and outbound frames, in order", async () => {
    const orchestrator = buildFakeOrchestrator();
    const socket = await connect(orchestrator);

    socket.emit("message", Buffer.from(startMessage()));
    socket.emit("message", Buffer.from(mediaMessage("outbound", "aaa")));
    socket.emit("message", Buffer.from(mediaMessage("inbound", "bbb")));
    socket.emit("message", Buffer.from(mediaMessage("outbound", "ccc")));
    socket.emit("message", Buffer.from(mediaMessage("inbound", "ddd")));

    expect(orchestrator.onAudioFrame).toHaveBeenCalledTimes(2);
    expect(orchestrator.onAudioFrame).toHaveBeenNthCalledWith(1, Buffer.from("bbb", "base64"));
    expect(orchestrator.onAudioFrame).toHaveBeenNthCalledWith(2, Buffer.from("ddd", "base64"));
  });
});

/**
 * QA security audit finding: `/media-stream` previously had zero
 * authentication of its own — anyone reaching the public WebSocket URL
 * could forge a `start` event with an arbitrary tenantId/businessId,
 * bypassing TwilioSignatureGuard entirely (that guard protects only the
 * separate webhook POST that generates the TwiML this URL comes from).
 * See media-stream-auth.util.ts's own comment for the full exploit and
 * fix. These tests prove the fix actually blocks a connection at the
 * gateway itself — `onCallStart` must never be reached without a token
 * that verifies against the EXACT customParameters received.
 */
describe("MediaStreamGateway — media-stream authentication", () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env["TWILIO_AUTH_TOKEN"] = TEST_AUTH_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("never calls onCallStart when mediaStreamToken is missing entirely", async () => {
    const orchestrator = buildFakeOrchestrator();
    const socket = await connect(orchestrator);
    const withoutToken = JSON.parse(startMessage()) as {
      start: { customParameters: Record<string, string> };
    };
    delete withoutToken.start.customParameters["mediaStreamToken"];

    socket.emit("message", Buffer.from(JSON.stringify(withoutToken)));

    expect(orchestrator.onCallStart).not.toHaveBeenCalled();
  });

  it("never calls onCallStart when mediaStreamToken does not match the received parameters (forged/tampered)", async () => {
    const orchestrator = buildFakeOrchestrator();
    const socket = await connect(orchestrator);

    socket.emit("message", Buffer.from(startMessage({ mediaStreamToken: "not-a-real-token" })));

    expect(orchestrator.onCallStart).not.toHaveBeenCalled();
  });

  it("never calls onCallStart when a valid token from ONE call is replayed alongside a DIFFERENT tenantId (the exact forgery this exists to stop)", async () => {
    const orchestrator = buildFakeOrchestrator();
    const socket = await connect(orchestrator);
    // A genuinely valid token for tenant-1, replayed with tenantId swapped
    // to attacker-tenant — proves the token is bound to the actual
    // parameter VALUES, not merely "some valid-looking token is present."
    const validMessage = JSON.parse(startMessage()) as {
      start: { customParameters: Record<string, string> };
    };
    const forgedParams = {
      ...validMessage.start.customParameters,
      tenantId: "attacker-tenant",
    };
    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          ...validMessage,
          start: { ...validMessage.start, customParameters: forgedParams },
        }),
      ),
    );

    expect(orchestrator.onCallStart).not.toHaveBeenCalled();
  });

  it("closes the socket when authentication fails", async () => {
    const orchestrator = buildFakeOrchestrator();
    const socket = await connect(orchestrator);
    let closed = false;
    socket.on("close", () => {
      closed = true;
    });

    socket.emit("message", Buffer.from(startMessage({ mediaStreamToken: "invalid" })));

    expect(closed).toBe(true);
  });

  it("DOES call onCallStart when the token genuinely verifies against the exact parameters received", async () => {
    const orchestrator = buildFakeOrchestrator();
    const socket = await connect(orchestrator);

    socket.emit("message", Buffer.from(startMessage()));

    expect(orchestrator.onCallStart).toHaveBeenCalledTimes(1);
  });

  it("never calls onCallStart when TWILIO_AUTH_TOKEN is unset at connection time (fails closed, not open)", async () => {
    delete process.env["TWILIO_AUTH_TOKEN"];
    const orchestrator = buildFakeOrchestrator();
    const socket = await connect(orchestrator);

    socket.emit("message", Buffer.from(startMessage()));

    expect(orchestrator.onCallStart).not.toHaveBeenCalled();
  });
});
