import { Inject, Injectable } from "@nestjs/common";
import WebSocket from "ws";
import type { StructuredLogger } from "@ethixweb/shared-kernel";
import { APP_LOGGER } from "../../../shared/observability/app-logger.module";
import type { SpeechToTextProvider, SpeechToTextSession } from "../domain/speech-to-text.port";

const DEEPGRAM_LISTEN_URL = "wss://api.deepgram.com/v1/listen";

/**
 * [Unverified against a live Deepgram key in this environment — same
 * epistemic-honesty posture as this repo's TwilioSignatureGuard/
 * twilio-signature.util.ts.] Built directly against Deepgram's publicly
 * documented raw streaming WebSocket API (`wss://api.deepgram.com/v1/listen`,
 * `Authorization: token <key>` header, query params `encoding`/
 * `sample_rate`/`channels`/`interim_results`/`vad_events`/`model`), NOT the
 * `@deepgram/sdk` package — kept dependency-minimal per this build's own
 * "no premature abstraction" instruction, and the raw protocol is stable
 * public API surface, not an internal implementation detail. Message shape
 * (`type: "Results"`, `is_final`, `speech_final`,
 * `channel.alternatives[0].transcript/confidence`, and `type:
 * "SpeechStarted"` when `vad_events=true`) is Deepgram's documented
 * contract.
 *
 * `speech_final` (not `is_final` alone) gates onFinalTranscript: Deepgram
 * can emit `is_final: true` on an endpointed chunk that is NOT yet the end
 * of the caller's utterance (e.g., a long pause mid-sentence) — only
 * `speech_final` is documented as "the end of speech has been detected",
 * matching docs/28 §B.2's requirement that only genuinely finalized
 * utterances reach voice-orchestrator's /turns endpoint.
 *
 * LANGUAGE: `DEEPGRAM_LANGUAGE` (default `"multi"`) is Deepgram's own
 * multilingual code-switching mode — verified against Deepgram's current
 * docs, not guessed: it transcribes English and Spanish (the documented
 * pair) within the SAME call with no separate detection step, exactly
 * what a caller switching languages mid-sentence needs. This is a real
 * constraint, not a free choice: Deepgram's domain-tuned model variants
 * (`nova-2-phonecall` included) only support English and explicitly do
 * NOT support `language=multi` — only the base `nova-2`/`nova-2-general`
 * models do. So the model default below is coupled to the language
 * default: `multi` language pairs with base `nova-2` (small phone-audio
 * tuning tradeoff, in exchange for Spanish support), an explicit
 * non-multi `DEEPGRAM_LANGUAGE` keeps the phone-tuned model. An operator
 * who sets `DEEPGRAM_MODEL` explicitly always gets exactly that model,
 * verbatim — this default coupling only fills the gap when they haven't.
 */
const MULTILINGUAL_MODEL = "nova-2";
const PHONE_TUNED_MODEL = "nova-2-phonecall";
const DEFAULT_LANGUAGE = "multi";

@Injectable()
export class DeepgramSttProvider implements SpeechToTextProvider {
  constructor(@Inject(APP_LOGGER) private readonly logger: StructuredLogger) {}

  async openSession(options: {
    sampleRateHz: number;
    encoding: "mulaw" | "linear16";
  }): Promise<SpeechToTextSession> {
    const apiKey = process.env["DEEPGRAM_API_KEY"];
    if (!apiKey) {
      throw new Error("DEEPGRAM_API_KEY is not configured");
    }
    const language = process.env["DEEPGRAM_LANGUAGE"] ?? DEFAULT_LANGUAGE;
    const model =
      process.env["DEEPGRAM_MODEL"] ??
      (language === "multi" ? MULTILINGUAL_MODEL : PHONE_TUNED_MODEL);

    const encoding = options.encoding === "mulaw" ? "mulaw" : "linear16";
    const url =
      `${DEEPGRAM_LISTEN_URL}?encoding=${encoding}&sample_rate=${options.sampleRateHz}` +
      `&channels=1&interim_results=true&vad_events=true&endpointing=300` +
      `&model=${model}&language=${language}`;

    const socket = new WebSocket(url, { headers: { Authorization: `token ${apiKey}` } });

    return new DeepgramSttSession(socket, this.logger, { model, language });
  }
}

class DeepgramSttSession implements SpeechToTextSession {
  private finalHandler: ((result: { transcript: string; confidence: number }) => void) | null =
    null;
  private speechStartedHandler: (() => void) | null = null;
  private errorHandler: ((error: Error) => void) | null = null;
  private readonly pendingAudio: Buffer[] = [];
  private ready = false;
  private framesSent = 0;

  constructor(
    private readonly socket: WebSocket,
    private readonly logger: StructuredLogger,
    private readonly connectionInfo: { model: string; language: string },
  ) {
    socket.on("open", () => {
      this.ready = true;
      this.logger.info("Deepgram session opened", {
        ...this.connectionInfo,
        bufferedFramesFlushed: this.pendingAudio.length,
      });
      for (const frame of this.pendingAudio.splice(0)) {
        socket.send(frame);
      }
    });
    socket.on("message", (data: WebSocket.RawData) => this.handleMessage(data));
    socket.on("error", (error: Error) => {
      this.logger.error("Deepgram session error", { reason: error.message });
      this.errorHandler?.(error);
    });
    // Found live, not hypothetical: a real call produced zero transcripts
    // and zero errors — this class previously had NO close handler at
    // all, so a Deepgram-side rejection (bad auth, an unsupported model/
    // language/encoding combination, a mid-call disconnect) that closes
    // the socket WITHOUT ever firing "error" was completely invisible;
    // audio kept arriving via sendAudio() and silently vanished into a
    // closed socket for the rest of the call. Only logs when the close
    // wasn't this session's own close() (code 1000, or no code at all
    // because sockets that never finished opening report none) — most
    // real diagnostic value is in the abnormal-close case.
    socket.on("close", (code: number, reason: Buffer) => {
      if (code !== 1000) {
        this.logger.warn("Deepgram session closed unexpectedly", {
          code,
          reason: reason.toString("utf8"),
          framesSent: this.framesSent,
          wasReady: this.ready,
        });
      }
    });
  }

  sendAudio(frame: Buffer): void {
    this.framesSent += 1;
    if (this.ready && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(frame);
    } else {
      // Deepgram's connection handshake is a few hundred ms — buffering the
      // first frames rather than dropping them avoids losing the caller's
      // opening words if TTS/greeting playback starts before the socket is
      // fully open.
      this.pendingAudio.push(frame);
    }
  }

  onFinalTranscript(handler: (result: { transcript: string; confidence: number }) => void): void {
    this.finalHandler = handler;
  }

  onSpeechStarted(handler: () => void): void {
    this.speechStartedHandler = handler;
  }

  onError(handler: (error: Error) => void): void {
    this.errorHandler = handler;
  }

  async close(): Promise<void> {
    if (this.socket.readyState === WebSocket.OPEN) {
      // Deepgram's documented graceful-close message — flushes any
      // in-flight finalization before the socket actually closes, rather
      // than dropping the last few hundred ms of audio on a hard close.
      this.socket.send(JSON.stringify({ type: "CloseStream" }));
    }
    this.socket.close();
  }

  private handleMessage(data: WebSocket.RawData): void {
    // Deepgram's `Results`/`SpeechStarted` events are always TEXT frames
    // (JSON) — `RawData` is typed as a union including `Buffer[]` only
    // because `ws` allows fragmented binary frames in general, which
    // Deepgram never sends on this channel. `Buffer.concat` (not
    // `.toString()` on the union directly) avoids relying on Array's
    // default `Object.prototype.toString` join behavior for that branch.
    const raw = Array.isArray(data)
      ? Buffer.concat(data)
      : Buffer.isBuffer(data)
        ? data
        : Buffer.from(data);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString("utf8"));
    } catch {
      return;
    }
    if (typeof parsed !== "object" || parsed === null) {
      return;
    }
    const message = parsed as Record<string, unknown>;

    if (message["type"] === "SpeechStarted") {
      this.speechStartedHandler?.();
      return;
    }

    // Found live, not hypothetical: a real call produced zero transcripts
    // AND zero errors — nothing anywhere logged what Deepgram was
    // actually sending back, so there was no way to tell "no audio is
    // reaching Deepgram" apart from "audio is arriving but never
    // finalizing" apart from "Deepgram is rejecting the connection
    // silently." Every Results message (interim included) is now logged
    // at debug-equivalent detail — is_final/speech_final/transcript
    // length/confidence, never the raw transcript text itself (this
    // logger has no PII-redaction pipeline downstream, unlike
    // tool_calls.input's documented redaction path).
    if (message["type"] === "Results") {
      const channel = message["channel"] as
        { alternatives?: Array<Record<string, unknown>> } | undefined;
      const alternative = channel?.alternatives?.[0];
      const transcript =
        typeof alternative?.["transcript"] === "string" ? alternative["transcript"] : "";
      const confidence =
        typeof alternative?.["confidence"] === "number" ? alternative["confidence"] : 0;
      this.logger.info("Deepgram Results event", {
        isFinal: message["is_final"] === true,
        speechFinal: message["speech_final"] === true,
        transcriptLength: transcript.length,
        confidence,
      });

      if (message["speech_final"] !== true) {
        return;
      }
      if (transcript.trim().length === 0) {
        // Deepgram emits a final, empty-transcript result at the tail of
        // silence — not a caller utterance, must not reach /turns as an
        // empty transcript (HandleTurnDto requires @Length(1, 8000)).
        return;
      }
      // Temporary, targeted addition (not the general Results log above,
      // which deliberately omits transcript text) — actively diagnosing
      // a real live report that a name given in one utterance ("Akash
      // Lakwhan") only registered as a first name, with the AI still
      // asking for a last name. The constant noise-triggered empty
      // speech_final cycling seen in Results logs is a real candidate
      // for fragmenting one utterance into pieces; only the actual
      // finalized text proves it either way.
      this.logger.info("Deepgram finalized transcript", { transcript, confidence });
      this.finalHandler?.({ transcript, confidence });
      return;
    }

    // Deepgram's documented error frame — arrives as an ordinary JSON
    // text message on this same socket, not a WebSocket-level "error"
    // event, so the socket.on("error", ...) handler above never sees it.
    if (message["type"] === "Error" || typeof message["err_code"] === "string") {
      this.logger.error("Deepgram returned an error frame", {
        description: message["description"],
        errCode: message["err_code"],
      });
    }
  }
}
