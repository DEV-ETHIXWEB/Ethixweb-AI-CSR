import { Injectable } from "@nestjs/common";
import WebSocket from "ws";
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

    return new DeepgramSttSession(socket);
  }
}

class DeepgramSttSession implements SpeechToTextSession {
  private finalHandler: ((result: { transcript: string; confidence: number }) => void) | null =
    null;
  private speechStartedHandler: (() => void) | null = null;
  private errorHandler: ((error: Error) => void) | null = null;
  private readonly pendingAudio: Buffer[] = [];
  private ready = false;

  constructor(private readonly socket: WebSocket) {
    socket.on("open", () => {
      this.ready = true;
      for (const frame of this.pendingAudio.splice(0)) {
        socket.send(frame);
      }
    });
    socket.on("message", (data: WebSocket.RawData) => this.handleMessage(data));
    socket.on("error", (error: Error) => this.errorHandler?.(error));
  }

  sendAudio(frame: Buffer): void {
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

    if (message["type"] === "Results" && message["speech_final"] === true) {
      const channel = message["channel"] as
        { alternatives?: Array<Record<string, unknown>> } | undefined;
      const alternative = channel?.alternatives?.[0];
      const transcript =
        typeof alternative?.["transcript"] === "string" ? alternative["transcript"] : "";
      if (transcript.trim().length === 0) {
        // Deepgram emits a final, empty-transcript result at the tail of
        // silence — not a caller utterance, must not reach /turns as an
        // empty transcript (HandleTurnDto requires @Length(1, 8000)).
        return;
      }
      const confidence =
        typeof alternative?.["confidence"] === "number" ? alternative["confidence"] : 0;
      this.finalHandler?.({ transcript, confidence });
    }
  }
}
