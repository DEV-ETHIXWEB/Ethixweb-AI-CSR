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

/**
 * FOUND LIVE, not hypothetical: a real call's transcript showed a caller's
 * single continuous explanation ("because my kitchen is like floating" /
 * "and water is coming out of the broken pipe" / "yeah it is coming out" /
 * "it's still ready") arriving as FOUR separate finalized utterances, each
 * one firing its own full AI turn — and the caller's very next breath
 * (continuing the SAME thought) kept landing as a new Deepgram SpeechStarted
 * event that immediately aborted Grace's in-progress reply to the PREVIOUS
 * fragment (handleBargeIn, mechanism 1). With 300ms of silence enough to
 * call an utterance "final," an ordinary mid-sentence pause while a caller
 * is thinking or explaining is nearly always shorter than that, so this
 * setting was chopping natural speech into fragments and then having each
 * fragment's own reply cut off by the next — the caller ended up going 34
 * seconds this same call getting zero completed audible response and
 * explicitly asked "are you still connected on the call or not," captured
 * verbatim in that log. 500ms is a deliberately moderate middle ground, not
 * a guess: it's the commonly-recommended value for natural back-and-forth
 * conversational audio (300ms is Deepgram's aggressive/fast-reacting end of
 * the range, meant for short command-style utterances, not an open-ended
 * "tell me what happened" explanation). Real trade-off, stated plainly: a
 * genuinely short, complete utterance (a bare "yes"/"no") now takes up to
 * ~200ms longer to be recognized as finished — a small, deliberate cost
 * against the much larger cost this call actually measured.
 */
const ENDPOINTING_MS = 500;

/**
 * Found live: `ENDPOINTING_MS` above assumes a clean pause. A real call
 * showed the opposite failure — continuous low-level VAD-triggered
 * "SpeechStarted" activity (almost certainly background noise, not real
 * speech — dozens of SpeechStarted events with empty transcripts) kept
 * re-triggering before a clean 500ms silence window could ever complete,
 * so `speech_final` never arrived at all for over a MINUTE, despite
 * Deepgram having genuinely recognized real words partway through (an
 * `is_final: true` chunk with real transcript content, `speech_final:
 * false`, mid-window). That entire utterance — and the rest of the call,
 * which ended in a caller hangup with nothing captured — was silently
 * lost with no recovery path at all.
 *
 * This is an application-level safety net independent of Deepgram's own
 * endpointing: if the most recently recognized non-empty `is_final`
 * transcript hasn't been superseded (by a real `speech_final`, or a
 * newer/different `is_final` chunk resetting this same timer) within this
 * window, treat it as good enough and deliver it anyway — the same "fail
 * toward action, not silent loss" principle handle-turn.use-case.ts
 * already applies to escalateEmergency/searchCustomer, applied here at
 * the STT layer instead. Deliberately restricted to `is_final: true`
 * chunks only (never a still-interim one) — that's the one thing
 * Deepgram's own contract says won't be revised further, matching this
 * class's existing "only genuinely finalized" posture as closely as a
 * bounded exception can.
 */
const SPEECH_FINAL_FALLBACK_MS = 4000;

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
      `&channels=1&interim_results=true&vad_events=true&endpointing=${ENDPOINTING_MS}` +
      `&model=${model}&language=${language}`;

    const socket = new WebSocket(url, { headers: { Authorization: `token ${apiKey}` } });

    return new DeepgramSttSession(socket, this.logger, { model, language });
  }
}

class DeepgramSttSession implements SpeechToTextSession {
  private finalHandler: ((result: { transcript: string; confidence: number }) => void) | null =
    null;
  private speechStartedHandler: (() => void) | null = null;
  private interimSpeechHandler: ((transcript: string) => void) | null = null;
  private errorHandler: ((error: Error) => void) | null = null;
  private readonly pendingAudio: Buffer[] = [];
  private ready = false;
  private framesSent = 0;
  /** See `SPEECH_FINAL_FALLBACK_MS`'s own comment for why this exists. */
  private pendingFallback: { transcript: string; confidence: number } | null = null;
  private pendingFallbackTimer: ReturnType<typeof setTimeout> | null = null;

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

  onInterimSpeech(handler: (transcript: string) => void): void {
    this.interimSpeechHandler = handler;
  }

  onError(handler: (error: Error) => void): void {
    this.errorHandler = handler;
  }

  async close(): Promise<void> {
    this.clearPendingFallback();
    if (this.socket.readyState === WebSocket.OPEN) {
      // Deepgram's documented graceful-close message — flushes any
      // in-flight finalization before the socket actually closes, rather
      // than dropping the last few hundred ms of audio on a hard close.
      this.socket.send(JSON.stringify({ type: "CloseStream" }));
    }
    this.socket.close();
  }

  private clearPendingFallback(): void {
    if (this.pendingFallbackTimer) {
      clearTimeout(this.pendingFallbackTimer);
      this.pendingFallbackTimer = null;
    }
    this.pendingFallback = null;
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
      // A real observability gap found while chasing a live silent-call
      // report: this event drives barge-in (CallSessionOrchestrator's
      // own handleBargeIn), which itself logs NOTHING when its mechanism-1
      // path fires (aborting an in-flight turn) — meaning there was
      // previously no way to distinguish "the caller genuinely
      // interrupted" from "something else silently killed the turn" by
      // reading logs alone. That ambiguity cost real diagnostic time.
      this.logger.info("Deepgram SpeechStarted event");
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
        // Barge-in CONFIRMATION signal — see onInterimSpeech's own
        // comment on the port. Only fires with actual recognized text,
        // never on an empty interim result (those are just as
        // meaningless as a bare VAD blip for telling real speech apart
        // from noise).
        if (transcript.trim().length > 0) {
          this.interimSpeechHandler?.(transcript);
        }
        // SPEECH_FINAL_FALLBACK_MS safety net — see that constant's own
        // comment. Only an `is_final: true` chunk counts (Deepgram's
        // contract says it won't be revised further); a still-interim
        // one is too unstable to fall back to. Re-arms the timer only
        // when the transcript actually changed, so a genuinely growing
        // utterance keeps extending the window instead of firing early.
        if (
          message["is_final"] === true &&
          transcript.trim().length > 0 &&
          transcript !== this.pendingFallback?.transcript
        ) {
          this.pendingFallback = { transcript, confidence };
          if (this.pendingFallbackTimer) {
            clearTimeout(this.pendingFallbackTimer);
          }
          this.pendingFallbackTimer = setTimeout(() => {
            const pending = this.pendingFallback;
            this.clearPendingFallback();
            if (pending) {
              this.logger.warn(
                "speech_final never arrived — falling back to the last recognized transcript",
                { transcriptLength: pending.transcript.length, confidence: pending.confidence },
              );
              this.finalHandler?.(pending);
            }
          }, SPEECH_FINAL_FALLBACK_MS);
        }
        return;
      }
      this.clearPendingFallback();
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
