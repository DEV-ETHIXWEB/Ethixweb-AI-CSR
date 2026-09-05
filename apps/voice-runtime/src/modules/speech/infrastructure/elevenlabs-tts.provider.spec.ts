import { EventEmitter } from "node:events";

/**
 * No live ElevenLabs key in this environment (this provider's own comment
 * says so too) — same posture as deepgram-stt.provider.spec.ts: drive the
 * real logic (the 3-message open handshake, base64 audio decoding, the
 * isFinal/close/error end conditions, and AbortSignal handling) against a
 * fake `ws.WebSocket`, rather than leaving this genuinely non-trivial
 * async-generator + hand-rolled queue completely untested because the live
 * vendor boundary itself is unverifiable here.
 */
class FakeWebSocket extends EventEmitter {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  closeCallCount = 0;
  readonly url: string;

  constructor(url: string) {
    super();
    this.url = url;
  }

  send(frame: string): void {
    this.sent.push(frame);
  }

  close(): void {
    this.closeCallCount += 1;
    this.readyState = FakeWebSocket.CLOSED;
  }

  simulateOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.emit("open");
  }

  simulateAudioChunk(base64Audio: string): void {
    this.emit("message", Buffer.from(JSON.stringify({ audio: base64Audio, isFinal: false })));
  }

  simulateFinal(): void {
    this.emit("message", Buffer.from(JSON.stringify({ isFinal: true })));
  }
}

let lastSocket: FakeWebSocket | undefined;

jest.mock("ws", () => {
  return {
    __esModule: true,
    default: class {
      constructor(url: string) {
        const socket = new FakeWebSocket(url);
        lastSocket = socket;
        return socket;
      }
      static readonly CONNECTING = FakeWebSocket.CONNECTING;
      static readonly OPEN = FakeWebSocket.OPEN;
      static readonly CLOSED = FakeWebSocket.CLOSED;
    },
  };
});

import { ElevenLabsTtsProvider } from "./elevenlabs-tts.provider";

describe("ElevenLabsTtsProvider", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env["ELEVENLABS_API_KEY"] = "test-elevenlabs-key";
    process.env["ELEVENLABS_VOICE_ID"] = "test-voice-id";
    lastSocket = undefined;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  it("throws before opening a socket when ELEVENLABS_API_KEY is not configured", async () => {
    delete process.env["ELEVENLABS_API_KEY"];
    const provider = new ElevenLabsTtsProvider();

    await expect(provider.synthesize("hello")[Symbol.asyncIterator]().next()).rejects.toThrow(
      "ELEVENLABS_API_KEY is not configured",
    );
    expect(lastSocket).toBeUndefined();
  });

  it("throws before opening a socket when ELEVENLABS_VOICE_ID is not configured", async () => {
    delete process.env["ELEVENLABS_VOICE_ID"];
    const provider = new ElevenLabsTtsProvider();

    await expect(provider.synthesize("hello")[Symbol.asyncIterator]().next()).rejects.toThrow(
      "ELEVENLABS_VOICE_ID is not configured",
    );
    expect(lastSocket).toBeUndefined();
  });

  it("opens the documented stream-input URL and sends the 3-message handshake on open", async () => {
    const provider = new ElevenLabsTtsProvider();
    const iterator = provider.synthesize("Connecting you now.")[Symbol.asyncIterator]();
    const nextPromise = iterator.next();

    expect(lastSocket).toBeDefined();
    expect(lastSocket!.url).toBe(
      "wss://api.elevenlabs.io/v1/text-to-speech/test-voice-id/stream-input?output_format=ulaw_8000&model_id=eleven_turbo_v2_5",
    );

    lastSocket!.simulateOpen();

    expect(lastSocket!.sent).toEqual([
      JSON.stringify({
        text: " ",
        voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0, speed: 1 },
        xi_api_key: "test-elevenlabs-key",
      }),
      JSON.stringify({ text: "Connecting you now. ", flush: true }),
      JSON.stringify({ text: "" }),
    ]);

    lastSocket!.simulateFinal();
    await expect(nextPromise).resolves.toEqual({ value: undefined, done: true });
  });

  it("sends the given voiceSettings instead of the default when the caller supplies emotional-delivery values", async () => {
    const provider = new ElevenLabsTtsProvider();
    const iterator = provider
      .synthesize("I'm sorry that happened.", undefined, {
        stability: 0.35,
        similarityBoost: 0.75,
        style: 0.4,
        speed: 0.95,
      })
      [Symbol.asyncIterator]();
    void iterator.next();
    lastSocket!.simulateOpen();

    expect(lastSocket!.sent[0]).toBe(
      JSON.stringify({
        text: " ",
        voice_settings: { stability: 0.35, similarity_boost: 0.75, style: 0.4, speed: 0.95 },
        xi_api_key: "test-elevenlabs-key",
      }),
    );
  });

  it("uses ELEVENLABS_MODEL_ID when set, instead of the eleven_turbo_v2_5 default", async () => {
    process.env["ELEVENLABS_MODEL_ID"] = "eleven_v3";
    const provider = new ElevenLabsTtsProvider();
    const iterator = provider.synthesize("hi")[Symbol.asyncIterator]();
    void iterator.next();

    expect(lastSocket!.url).toContain("model_id=eleven_v3");
  });

  it("yields each audio chunk decoded from base64 as it arrives, in order", async () => {
    const provider = new ElevenLabsTtsProvider();
    const iterator = provider.synthesize("hello there")[Symbol.asyncIterator]();

    const first = iterator.next();
    lastSocket!.simulateOpen();
    const chunkA = Buffer.from("chunk-a-audio-bytes").toString("base64");
    lastSocket!.simulateAudioChunk(chunkA);
    await expect(first).resolves.toEqual({
      value: Buffer.from("chunk-a-audio-bytes"),
      done: false,
    });

    const second = iterator.next();
    const chunkB = Buffer.from("chunk-b-audio-bytes").toString("base64");
    lastSocket!.simulateAudioChunk(chunkB);
    await expect(second).resolves.toEqual({
      value: Buffer.from("chunk-b-audio-bytes"),
      done: false,
    });

    const third = iterator.next();
    lastSocket!.simulateFinal();
    await expect(third).resolves.toEqual({ value: undefined, done: true });
  });

  it("ends the stream when the socket closes, even without an isFinal message", async () => {
    const provider = new ElevenLabsTtsProvider();
    const iterator = provider.synthesize("hello")[Symbol.asyncIterator]();
    const next = iterator.next();
    lastSocket!.simulateOpen();

    lastSocket!.emit("close");

    await expect(next).resolves.toEqual({ value: undefined, done: true });
  });

  it("rejects the pending chunk when the socket errors, rather than silently ending", async () => {
    const provider = new ElevenLabsTtsProvider();
    const iterator = provider.synthesize("hello")[Symbol.asyncIterator]();
    const next = iterator.next();
    lastSocket!.simulateOpen();

    const err = new Error("elevenlabs connection reset");
    lastSocket!.emit("error", err);

    await expect(next).rejects.toThrow("elevenlabs connection reset");
  });

  it("closes the socket and stops yielding once the AbortSignal fires", async () => {
    const controller = new AbortController();
    const provider = new ElevenLabsTtsProvider();
    const iterator = provider.synthesize("hello", controller.signal)[Symbol.asyncIterator]();
    const next = iterator.next();
    lastSocket!.simulateOpen();

    controller.abort();

    await expect(next).resolves.toEqual({ value: undefined, done: true });
    expect(lastSocket!.closeCallCount).toBeGreaterThanOrEqual(1);
  });

  it("closes the socket in the finally block once the stream ends normally, since it was left OPEN", async () => {
    const provider = new ElevenLabsTtsProvider();
    const iterator = provider.synthesize("hello")[Symbol.asyncIterator]();
    const next = iterator.next();
    lastSocket!.simulateOpen();
    lastSocket!.simulateFinal();
    await next;

    // Drain the for-await loop in synthesize() to its finally block —
    // AudioChunkQueue is already ended, so this resolves immediately.
    await iterator.next();

    expect(lastSocket!.closeCallCount).toBe(1);
  });
});
