import { EventEmitter } from "node:events";
import { DEFAULT_VOICE_DELIVERY_SETTINGS } from "../domain/text-to-speech.port";

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
      "wss://api.elevenlabs.io/v1/text-to-speech/test-voice-id/stream-input?output_format=ulaw_8000&model_id=eleven_turbo_v2_5&inactivity_timeout=120",
    );

    lastSocket!.simulateOpen();

    expect(lastSocket!.sent).toEqual([
      JSON.stringify({
        text: " ",
        voice_settings: {
          stability: DEFAULT_VOICE_DELIVERY_SETTINGS.stability,
          similarity_boost: DEFAULT_VOICE_DELIVERY_SETTINGS.similarityBoost,
          style: DEFAULT_VOICE_DELIVERY_SETTINGS.style,
          speed: DEFAULT_VOICE_DELIVERY_SETTINGS.speed,
        },
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
    const socket = lastSocket!;
    socket.simulateOpen();

    controller.abort();

    await expect(next).resolves.toEqual({ value: undefined, done: true });
    expect(socket.closeCallCount).toBeGreaterThanOrEqual(1);
  });

  it("closes the socket in the finally block once the stream ends normally, since it was left OPEN", async () => {
    const provider = new ElevenLabsTtsProvider();
    const iterator = provider.synthesize("hello")[Symbol.asyncIterator]();
    const next = iterator.next();
    const socket = lastSocket!;
    socket.simulateOpen();
    socket.simulateFinal();
    await next;

    // Drain the for-await loop in synthesize() to its finally block —
    // AudioChunkQueue is already ended, so this resolves immediately.
    await iterator.next();

    expect(socket.closeCallCount).toBe(1);
  });

  describe("replay cache for recurring short utterances (pickup latency)", () => {
    async function renderFully(provider: ElevenLabsTtsProvider, text: string): Promise<Buffer[]> {
      const out: Buffer[] = [];
      const iterator = provider.synthesize(text)[Symbol.asyncIterator]();
      const first = iterator.next();
      lastSocket!.simulateOpen();
      lastSocket!.simulateAudioChunk(Buffer.from("aaa").toString("base64"));
      lastSocket!.simulateAudioChunk(Buffer.from("bbb").toString("base64"));
      lastSocket!.simulateFinal();
      let step = await first;
      while (!step.done) {
        out.push(step.value);
        step = await iterator.next();
      }
      return out;
    }

    it("replays a completed greeting on the next call without opening a new ElevenLabs socket", async () => {
      const provider = new ElevenLabsTtsProvider();
      const firstRender = await renderFully(
        provider,
        "Hi, this is Grace at All Phase Plumbing. What can I help you with?",
      );
      const socketAfterFirst = lastSocket;
      lastSocket = undefined;

      const replay: Buffer[] = [];
      for await (const chunk of provider.synthesize(
        "Hi, this is Grace at All Phase Plumbing. What can I help you with?",
      )) {
        replay.push(chunk);
      }

      expect(lastSocket).toBeUndefined();
      expect(socketAfterFirst).toBeDefined();
      expect(Buffer.concat(replay).toString()).toBe(Buffer.concat(firstRender).toString());
    });

    it("never caches a render that ElevenLabs did not finish, so a truncated clip can never be replayed", async () => {
      const provider = new ElevenLabsTtsProvider();
      const iterator = provider.synthesize("Sounds good, take care.")[Symbol.asyncIterator]();
      const first = iterator.next();
      lastSocket!.simulateOpen();
      lastSocket!.simulateAudioChunk(Buffer.from("partial").toString("base64"));
      lastSocket!.emit("close");
      let step = await first;
      while (!step.done) {
        step = await iterator.next();
      }
      const spare = lastSocket!;

      const again = provider.synthesize("Sounds good, take care.")[Symbol.asyncIterator]();
      void again.next();
      spare.simulateOpen();

      expect(spare.sent).toContain(
        JSON.stringify({ text: "Sounds good, take care. ", flush: true }),
      );
    });

    it("never caches a render cut short by barge-in", async () => {
      const provider = new ElevenLabsTtsProvider();
      const controller = new AbortController();
      const iterator = provider
        .synthesize("Let me know if anything changes.", controller.signal)
        [Symbol.asyncIterator]();
      const first = iterator.next();
      lastSocket!.simulateOpen();
      lastSocket!.simulateAudioChunk(Buffer.from("half").toString("base64"));
      controller.abort();
      lastSocket!.simulateFinal();
      let step = await first;
      while (!step.done) {
        step = await iterator.next();
      }
      const spare = lastSocket!;

      const again = provider.synthesize("Let me know if anything changes.")[Symbol.asyncIterator]();
      void again.next();
      spare.simulateOpen();

      expect(spare.sent).toContain(
        JSON.stringify({ text: "Let me know if anything changes. ", flush: true }),
      );
    });

    it("treats a different emotional delivery of the same words as a different clip", async () => {
      const provider = new ElevenLabsTtsProvider();
      await renderFully(provider, "I'm sorry to hear that.");
      const spare = lastSocket!;

      const iterator = provider
        .synthesize("I'm sorry to hear that.", undefined, {
          stability: 0.3,
          similarityBoost: 0.75,
          style: 0.5,
          speed: 0.9,
        })
        [Symbol.asyncIterator]();
      void iterator.next();
      spare.simulateOpen();

      expect(spare.sent).toContain(
        JSON.stringify({ text: "I'm sorry to hear that. ", flush: true }),
      );
    });
  });

  /** 2026-10-23, client: "it usually takes 5 full seconds to answer". About 300 ms of each reply was opening a socket. */
  describe("a socket opened ahead of time", () => {
    it("starts the next reply on the socket opened after the last one, with no new connection", async () => {
      const provider = new ElevenLabsTtsProvider();
      const first = provider.synthesize("Okay.")[Symbol.asyncIterator]();
      const step = first.next();
      const replySocket = lastSocket!;
      replySocket.simulateOpen();
      replySocket.simulateFinal();
      await step;
      await first.next();
      const spare = lastSocket!;
      expect(spare).not.toBe(replySocket);
      spare.simulateOpen(); // connected while the caller was talking

      const second = provider.synthesize("What's the address?")[Symbol.asyncIterator]();
      void second.next();

      // Sent at once, on the open spare: no connect on the reply's path.
      expect(lastSocket).toBe(spare);
      expect(spare.sent).toContain(JSON.stringify({ text: "What's the address? ", flush: true }));
    });

    it("never uses a spare the server has closed", async () => {
      const provider = new ElevenLabsTtsProvider();
      const first = provider.synthesize("Okay.")[Symbol.asyncIterator]();
      const step = first.next();
      lastSocket!.simulateOpen();
      lastSocket!.simulateFinal();
      await step;
      await first.next();
      const spare = lastSocket!;
      spare.close(); // the server timed it out

      const second = provider.synthesize("What's the address?")[Symbol.asyncIterator]();
      void second.next();

      expect(lastSocket).not.toBe(spare);
      expect(spare.sent).toEqual([]);
    });

    it("opens a spare when the greeting is replayed from cache, so the first answer is fast too", async () => {
      const provider = new ElevenLabsTtsProvider();
      const greeting = "Hi, this is Grace. What can I help you with?";
      const first = provider.synthesize(greeting)[Symbol.asyncIterator]();
      const step = first.next();
      lastSocket!.simulateOpen();
      lastSocket!.simulateAudioChunk(Buffer.from("hi").toString("base64"));
      lastSocket!.simulateFinal();
      let result = await step;
      while (!result.done) {
        result = await first.next();
      }
      // A later call: its spare was used up by another reply in between.
      const used = provider.synthesize("Okay.")[Symbol.asyncIterator]();
      void used.next();
      lastSocket = undefined;

      for await (const chunk of provider.synthesize(greeting)) {
        void chunk;
      }
      expect(lastSocket).toBeDefined();
    });
  });
});

describe("ElevenLabsTtsProvider.warmUp (2026-10-24: a cold first reply)", () => {
  beforeEach(() => {
    process.env["ELEVENLABS_API_KEY"] = "test-elevenlabs-key";
    process.env["ELEVENLABS_VOICE_ID"] = "test-voice-id";
    lastSocket = undefined;
  });

  it("renders one throwaway word on its own socket and closes it when done", () => {
    const provider = new ElevenLabsTtsProvider();
    provider.warmUp();
    const socket = lastSocket!;
    socket.simulateOpen();
    expect(socket.sent.some((frame) => frame.includes('"Okay. "'))).toBe(true);
    socket.simulateFinal();
    expect(socket.closeCallCount).toBe(1);
  });

  it("does nothing again within a minute", () => {
    const provider = new ElevenLabsTtsProvider();
    provider.warmUp();
    const first = lastSocket;
    provider.warmUp();
    expect(lastSocket).toBe(first);
  });
});
