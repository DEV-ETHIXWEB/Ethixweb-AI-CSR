import { EventEmitter } from "node:events";

/**
 * No live Deepgram key in this environment (this provider's own comment
 * says so too) — the honest, structural next-best thing is to drive the
 * REAL message-handling logic (speech_final gating, empty-transcript
 * filtering, pre-open audio buffering, SpeechStarted/error routing)
 * against a fake `ws.WebSocket` that behaves exactly like the real one as
 * an EventEmitter, rather than testing nothing because the live provider
 * is unverifiable. `jest.mock("ws")` replaces the module before the
 * provider under test imports it.
 */
class FakeWebSocket extends EventEmitter {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  readyState = FakeWebSocket.CONNECTING;
  sent: unknown[] = [];
  closed = false;
  readonly url: string;
  readonly options: unknown;

  constructor(url: string, options: unknown) {
    super();
    this.url = url;
    this.options = options;
  }

  send(frame: unknown): void {
    this.sent.push(frame);
  }

  close(): void {
    this.closed = true;
    this.readyState = FakeWebSocket.CLOSED;
  }

  simulateOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.emit("open");
  }

  simulateMessage(payload: unknown): void {
    this.emit("message", Buffer.from(JSON.stringify(payload)));
  }
}

let lastSocket: FakeWebSocket | undefined;

jest.mock("ws", () => {
  return {
    __esModule: true,
    default: class {
      constructor(url: string, options: unknown) {
        const socket = new FakeWebSocket(url, options);
        lastSocket = socket;
        return socket;
      }
      static readonly CONNECTING = FakeWebSocket.CONNECTING;
      static readonly OPEN = FakeWebSocket.OPEN;
      static readonly CLOSED = FakeWebSocket.CLOSED;
    },
  };
});

// Imported after jest.mock so the provider picks up the mocked module.
import { DeepgramSttProvider } from "./deepgram-stt.provider";

describe("DeepgramSttProvider", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env["DEEPGRAM_API_KEY"] = "test-deepgram-key";
    lastSocket = undefined;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  it("throws when DEEPGRAM_API_KEY is not configured", async () => {
    delete process.env["DEEPGRAM_API_KEY"];
    const provider = new DeepgramSttProvider();

    await expect(provider.openSession({ sampleRateHz: 8000, encoding: "mulaw" })).rejects.toThrow(
      "DEEPGRAM_API_KEY is not configured",
    );
  });

  it("opens the WebSocket against Deepgram's documented URL/query params and Authorization header, defaulting to multilingual (nova-2 + language=multi)", async () => {
    const provider = new DeepgramSttProvider();
    await provider.openSession({ sampleRateHz: 8000, encoding: "mulaw" });

    expect(lastSocket).toBeDefined();
    expect(lastSocket!.url).toBe(
      "wss://api.deepgram.com/v1/listen?encoding=mulaw&sample_rate=8000&channels=1&interim_results=true&vad_events=true&endpointing=300&model=nova-2&language=multi",
    );
    expect(lastSocket!.options).toEqual({ headers: { Authorization: "token test-deepgram-key" } });
  });

  it("uses DEEPGRAM_MODEL when set, instead of any default", async () => {
    process.env["DEEPGRAM_MODEL"] = "nova-3";
    const provider = new DeepgramSttProvider();
    await provider.openSession({ sampleRateHz: 16000, encoding: "linear16" });

    expect(lastSocket!.url).toContain("model=nova-3");
    expect(lastSocket!.url).toContain("encoding=linear16&sample_rate=16000");
  });

  /**
   * Regression coverage for a real constraint verified against Deepgram's
   * own current docs (not guessed): `language=multi` code-switching is
   * only supported on the base `nova-2`/`nova-2-general` models — the
   * domain-tuned variants (`nova-2-phonecall` included) only support
   * English and do not support `multi`. The model default is coupled to
   * the language default so the OUT-OF-THE-BOX combination always works;
   * an operator who explicitly sets DEEPGRAM_MODEL always gets exactly
   * that model, this coupling only fills the gap when they haven't.
   */
  describe("language/model coupling (Spanish/English code-switching)", () => {
    it("falls back to the phone-tuned model when DEEPGRAM_LANGUAGE is explicitly set to a single language, not multi", async () => {
      process.env["DEEPGRAM_LANGUAGE"] = "en";
      const provider = new DeepgramSttProvider();
      await provider.openSession({ sampleRateHz: 8000, encoding: "mulaw" });

      expect(lastSocket!.url).toContain("model=nova-2-phonecall");
      expect(lastSocket!.url).toContain("language=en");
    });

    it("respects an explicit DEEPGRAM_MODEL even when it's paired with the multilingual default language, rather than silently overriding the operator's choice", async () => {
      process.env["DEEPGRAM_MODEL"] = "nova-3";
      const provider = new DeepgramSttProvider();
      await provider.openSession({ sampleRateHz: 8000, encoding: "mulaw" });

      expect(lastSocket!.url).toContain("model=nova-3");
      expect(lastSocket!.url).toContain("language=multi");
    });
  });

  it("buffers audio frames sent before the socket opens, then flushes them in order once it does", async () => {
    const provider = new DeepgramSttProvider();
    const session = await provider.openSession({ sampleRateHz: 8000, encoding: "mulaw" });

    const frame1 = Buffer.from("frame-1");
    const frame2 = Buffer.from("frame-2");
    session.sendAudio(frame1);
    session.sendAudio(frame2);
    expect(lastSocket!.sent).toHaveLength(0);

    lastSocket!.simulateOpen();

    expect(lastSocket!.sent).toEqual([frame1, frame2]);
  });

  it("sends audio directly, without buffering, once the socket is already open", async () => {
    const provider = new DeepgramSttProvider();
    const session = await provider.openSession({ sampleRateHz: 8000, encoding: "mulaw" });
    lastSocket!.simulateOpen();

    const frame = Buffer.from("live-frame");
    session.sendAudio(frame);

    expect(lastSocket!.sent).toEqual([frame]);
  });

  it("fires onFinalTranscript only for a Results message with speech_final: true, not merely is_final: true", async () => {
    const provider = new DeepgramSttProvider();
    const session = await provider.openSession({ sampleRateHz: 8000, encoding: "mulaw" });
    const handler = jest.fn();
    session.onFinalTranscript(handler);

    lastSocket!.simulateMessage({
      type: "Results",
      is_final: true,
      speech_final: false,
      channel: { alternatives: [{ transcript: "mid-utterance pause", confidence: 0.9 }] },
    });
    expect(handler).not.toHaveBeenCalled();

    lastSocket!.simulateMessage({
      type: "Results",
      is_final: true,
      speech_final: true,
      channel: { alternatives: [{ transcript: "burst pipe in the basement", confidence: 0.95 }] },
    });
    expect(handler).toHaveBeenCalledWith({
      transcript: "burst pipe in the basement",
      confidence: 0.95,
    });
  });

  it("does not fire onFinalTranscript for a speech_final result with an empty transcript (tail-of-silence artifact)", async () => {
    const provider = new DeepgramSttProvider();
    const session = await provider.openSession({ sampleRateHz: 8000, encoding: "mulaw" });
    const handler = jest.fn();
    session.onFinalTranscript(handler);

    lastSocket!.simulateMessage({
      type: "Results",
      speech_final: true,
      channel: { alternatives: [{ transcript: "   ", confidence: 0 }] },
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("fires onSpeechStarted on a SpeechStarted event, without touching onFinalTranscript", async () => {
    const provider = new DeepgramSttProvider();
    const session = await provider.openSession({ sampleRateHz: 8000, encoding: "mulaw" });
    const speechStarted = jest.fn();
    const finalTranscript = jest.fn();
    session.onSpeechStarted(speechStarted);
    session.onFinalTranscript(finalTranscript);

    lastSocket!.simulateMessage({ type: "SpeechStarted" });

    expect(speechStarted).toHaveBeenCalledTimes(1);
    expect(finalTranscript).not.toHaveBeenCalled();
  });

  it("fires onError when the underlying socket emits an error", async () => {
    const provider = new DeepgramSttProvider();
    const session = await provider.openSession({ sampleRateHz: 8000, encoding: "mulaw" });
    const errorHandler = jest.fn();
    session.onError(errorHandler);

    const err = new Error("connection reset");
    lastSocket!.emit("error", err);

    expect(errorHandler).toHaveBeenCalledWith(err);
  });

  it("ignores a non-JSON message instead of throwing", async () => {
    const provider = new DeepgramSttProvider();
    const session = await provider.openSession({ sampleRateHz: 8000, encoding: "mulaw" });
    const handler = jest.fn();
    session.onFinalTranscript(handler);

    expect(() => lastSocket!.emit("message", Buffer.from("not json"))).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it("close() sends Deepgram's documented CloseStream message before closing an open socket", async () => {
    const provider = new DeepgramSttProvider();
    const session = await provider.openSession({ sampleRateHz: 8000, encoding: "mulaw" });
    lastSocket!.simulateOpen();

    await session.close();

    expect(lastSocket!.sent).toEqual([JSON.stringify({ type: "CloseStream" })]);
    expect(lastSocket!.closed).toBe(true);
  });

  it("close() just closes, without sending CloseStream, when the socket never reached OPEN", async () => {
    const provider = new DeepgramSttProvider();
    const session = await provider.openSession({ sampleRateHz: 8000, encoding: "mulaw" });

    await session.close();

    expect(lastSocket!.sent).toEqual([]);
    expect(lastSocket!.closed).toBe(true);
  });
});
