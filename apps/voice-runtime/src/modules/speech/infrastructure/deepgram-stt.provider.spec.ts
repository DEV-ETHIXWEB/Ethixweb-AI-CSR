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

  simulateClose(code: number, reason: string): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close", code, Buffer.from(reason));
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
import { createNoopLogger } from "./__fakes__/fake-logger";

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
    const provider = new DeepgramSttProvider(createNoopLogger());

    await expect(provider.openSession({ sampleRateHz: 8000, encoding: "mulaw" })).rejects.toThrow(
      "DEEPGRAM_API_KEY is not configured",
    );
  });

  it("opens the WebSocket against Deepgram's documented URL/query params and Authorization header, defaulting to multilingual (nova-2 + language=multi)", async () => {
    const provider = new DeepgramSttProvider(createNoopLogger());
    await provider.openSession({ sampleRateHz: 8000, encoding: "mulaw" });

    expect(lastSocket).toBeDefined();
    expect(lastSocket!.url).toBe(
      "wss://api.deepgram.com/v1/listen?encoding=mulaw&sample_rate=8000&channels=1&interim_results=true&vad_events=true&endpointing=500&model=nova-2&language=multi",
    );
    expect(lastSocket!.options).toEqual({ headers: { Authorization: "token test-deepgram-key" } });
  });

  it("uses DEEPGRAM_MODEL when set, instead of any default", async () => {
    process.env["DEEPGRAM_MODEL"] = "nova-3";
    const provider = new DeepgramSttProvider(createNoopLogger());
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
      const provider = new DeepgramSttProvider(createNoopLogger());
      await provider.openSession({ sampleRateHz: 8000, encoding: "mulaw" });

      expect(lastSocket!.url).toContain("model=nova-2-phonecall");
      expect(lastSocket!.url).toContain("language=en");
    });

    it("respects an explicit DEEPGRAM_MODEL even when it's paired with the multilingual default language, rather than silently overriding the operator's choice", async () => {
      process.env["DEEPGRAM_MODEL"] = "nova-3";
      const provider = new DeepgramSttProvider(createNoopLogger());
      await provider.openSession({ sampleRateHz: 8000, encoding: "mulaw" });

      expect(lastSocket!.url).toContain("model=nova-3");
      expect(lastSocket!.url).toContain("language=multi");
    });
  });

  it("buffers audio frames sent before the socket opens, then flushes them in order once it does", async () => {
    const provider = new DeepgramSttProvider(createNoopLogger());
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
    const provider = new DeepgramSttProvider(createNoopLogger());
    const session = await provider.openSession({ sampleRateHz: 8000, encoding: "mulaw" });
    lastSocket!.simulateOpen();

    const frame = Buffer.from("live-frame");
    session.sendAudio(frame);

    expect(lastSocket!.sent).toEqual([frame]);
  });

  it("fires onFinalTranscript only for a Results message with speech_final: true, not merely is_final: true", async () => {
    const provider = new DeepgramSttProvider(createNoopLogger());
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

  /**
   * Regression coverage for the real gap that made a live "caller says
   * something, nothing ever happens" bug undiagnosable: this class had
   * NO close handler at all, so a Deepgram-side rejection (bad auth, an
   * unsupported model/language/encoding combination, a mid-call
   * disconnect) that closes the socket WITHOUT ever firing "error" left
   * zero trace anywhere — audio kept arriving via sendAudio() into an
   * already-closed socket for the rest of the call, silently.
   */
  it("logs a warning when the socket closes abnormally (code !== 1000), including how many frames were already sent", async () => {
    const warn = jest.fn();
    const logger = { ...createNoopLogger(), warn };
    const provider = new DeepgramSttProvider(logger);
    const session = await provider.openSession({ sampleRateHz: 8000, encoding: "mulaw" });
    lastSocket!.simulateOpen();
    session.sendAudio(Buffer.from("frame-1"));
    session.sendAudio(Buffer.from("frame-2"));

    lastSocket!.simulateClose(1011, "internal error");

    expect(warn).toHaveBeenCalledWith(
      "Deepgram session closed unexpectedly",
      expect.objectContaining({ code: 1011, reason: "internal error", framesSent: 2 }),
    );
  });

  it("does NOT log a warning for an ordinary close (code 1000) — this session's own close() closing normally", async () => {
    const warn = jest.fn();
    const logger = { ...createNoopLogger(), warn };
    const provider = new DeepgramSttProvider(logger);
    const session = await provider.openSession({ sampleRateHz: 8000, encoding: "mulaw" });
    lastSocket!.simulateOpen();

    await session.close();
    lastSocket!.simulateClose(1000, "");

    expect(warn).not.toHaveBeenCalled();
  });

  it("does not fire onFinalTranscript for a speech_final result with an empty transcript (tail-of-silence artifact)", async () => {
    const provider = new DeepgramSttProvider(createNoopLogger());
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

  /**
   * Found live: a real call showed continuous low-level VAD-triggered
   * activity (almost certainly background noise) kept re-triggering
   * before a clean 500ms silence window could ever complete, so
   * `speech_final` never arrived at all for over a MINUTE despite
   * Deepgram having genuinely recognized real words ("wait a minute,
   * I'll just tell you my details" — an `is_final: true` chunk,
   * `speech_final: false`) partway through. That utterance, and the rest
   * of the call, was silently lost — the caller hung up with nothing
   * ever captured. This safety net exists specifically to close that gap.
   */
  describe("speech_final fallback (a real utterance that never gets a clean end-of-speech signal)", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("falls back to the last recognized is_final transcript when speech_final never arrives within the fallback window", async () => {
      const provider = new DeepgramSttProvider(createNoopLogger());
      const session = await provider.openSession({ sampleRateHz: 8000, encoding: "mulaw" });
      const handler = jest.fn();
      session.onFinalTranscript(handler);

      lastSocket!.simulateMessage({
        type: "Results",
        is_final: true,
        speech_final: false,
        channel: {
          alternatives: [
            { transcript: "wait a minute I'll just tell you my details", confidence: 0.99 },
          ],
        },
      });
      expect(handler).not.toHaveBeenCalled();

      jest.advanceTimersByTime(4000);

      expect(handler).toHaveBeenCalledWith({
        transcript: "wait a minute I'll just tell you my details",
        confidence: 0.99,
      });
    });

    it("does NOT fire the fallback when a real speech_final arrives before the window elapses", async () => {
      const provider = new DeepgramSttProvider(createNoopLogger());
      const session = await provider.openSession({ sampleRateHz: 8000, encoding: "mulaw" });
      const handler = jest.fn();
      session.onFinalTranscript(handler);

      lastSocket!.simulateMessage({
        type: "Results",
        is_final: true,
        speech_final: false,
        channel: { alternatives: [{ transcript: "burst pipe", confidence: 0.9 }] },
      });
      jest.advanceTimersByTime(1000);

      lastSocket!.simulateMessage({
        type: "Results",
        is_final: true,
        speech_final: true,
        channel: { alternatives: [{ transcript: "burst pipe in the basement", confidence: 0.95 }] },
      });
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({
        transcript: "burst pipe in the basement",
        confidence: 0.95,
      });

      jest.advanceTimersByTime(4000);
      expect(handler).toHaveBeenCalledTimes(1); // not called a second time by the (now-cleared) fallback
    });

    it("extends the fallback window when a newer, different is_final transcript arrives (a growing utterance)", async () => {
      const provider = new DeepgramSttProvider(createNoopLogger());
      const session = await provider.openSession({ sampleRateHz: 8000, encoding: "mulaw" });
      const handler = jest.fn();
      session.onFinalTranscript(handler);

      lastSocket!.simulateMessage({
        type: "Results",
        is_final: true,
        speech_final: false,
        channel: { alternatives: [{ transcript: "my sewer line", confidence: 0.9 }] },
      });
      jest.advanceTimersByTime(3000); // within the window, not yet fired

      lastSocket!.simulateMessage({
        type: "Results",
        is_final: true,
        speech_final: false,
        channel: { alternatives: [{ transcript: "my sewer line is backed up", confidence: 0.95 }] },
      });
      jest.advanceTimersByTime(3000); // would have fired the FIRST timer, but it was reset
      expect(handler).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1000); // completes the SECOND (reset) window
      expect(handler).toHaveBeenCalledWith({
        transcript: "my sewer line is backed up",
        confidence: 0.95,
      });
    });

    it("does NOT arm the fallback for a still-interim (not yet is_final) chunk — only genuinely finalized text is eligible", async () => {
      const provider = new DeepgramSttProvider(createNoopLogger());
      const session = await provider.openSession({ sampleRateHz: 8000, encoding: "mulaw" });
      const handler = jest.fn();
      session.onFinalTranscript(handler);

      lastSocket!.simulateMessage({
        type: "Results",
        is_final: false,
        speech_final: false,
        channel: { alternatives: [{ transcript: "still forming", confidence: 0.7 }] },
      });
      jest.advanceTimersByTime(4000);

      expect(handler).not.toHaveBeenCalled();
    });

    it("close() cancels any pending fallback so it never fires after the session has ended", async () => {
      const provider = new DeepgramSttProvider(createNoopLogger());
      const session = await provider.openSession({ sampleRateHz: 8000, encoding: "mulaw" });
      const handler = jest.fn();
      session.onFinalTranscript(handler);

      lastSocket!.simulateMessage({
        type: "Results",
        is_final: true,
        speech_final: false,
        channel: { alternatives: [{ transcript: "one two three", confidence: 0.9 }] },
      });

      await session.close();
      jest.advanceTimersByTime(4000);

      expect(handler).not.toHaveBeenCalled();
    });
  });

  it("fires onSpeechStarted on a SpeechStarted event, without touching onFinalTranscript", async () => {
    const provider = new DeepgramSttProvider(createNoopLogger());
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
    const provider = new DeepgramSttProvider(createNoopLogger());
    const session = await provider.openSession({ sampleRateHz: 8000, encoding: "mulaw" });
    const errorHandler = jest.fn();
    session.onError(errorHandler);

    const err = new Error("connection reset");
    lastSocket!.emit("error", err);

    expect(errorHandler).toHaveBeenCalledWith(err);
  });

  it("ignores a non-JSON message instead of throwing", async () => {
    const provider = new DeepgramSttProvider(createNoopLogger());
    const session = await provider.openSession({ sampleRateHz: 8000, encoding: "mulaw" });
    const handler = jest.fn();
    session.onFinalTranscript(handler);

    expect(() => lastSocket!.emit("message", Buffer.from("not json"))).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it("close() sends Deepgram's documented CloseStream message before closing an open socket", async () => {
    const provider = new DeepgramSttProvider(createNoopLogger());
    const session = await provider.openSession({ sampleRateHz: 8000, encoding: "mulaw" });
    lastSocket!.simulateOpen();

    await session.close();

    expect(lastSocket!.sent).toEqual([JSON.stringify({ type: "CloseStream" })]);
    expect(lastSocket!.closed).toBe(true);
  });

  it("close() just closes, without sending CloseStream, when the socket never reached OPEN", async () => {
    const provider = new DeepgramSttProvider(createNoopLogger());
    const session = await provider.openSession({ sampleRateHz: 8000, encoding: "mulaw" });

    await session.close();

    expect(lastSocket!.sent).toEqual([]);
    expect(lastSocket!.closed).toBe(true);
  });
});
