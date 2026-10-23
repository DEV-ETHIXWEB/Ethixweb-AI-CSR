import { Injectable } from "@nestjs/common";
import WebSocket from "ws";
import {
  DEFAULT_VOICE_DELIVERY_SETTINGS,
  type TextToSpeechProvider,
  type VoiceDeliverySettings,
} from "../domain/text-to-speech.port";

/**
 * [Unverified against a live ElevenLabs key in this environment — same
 * epistemic-honesty posture as deepgram-stt.provider.ts.] Built directly
 * against ElevenLabs' publicly documented WebSocket streaming API
 * (`wss://api.elevenlabs.io/v1/text-to-speech/{voiceId}/stream-input`).
 * `output_format=ulaw_8000` requested directly from the vendor via query
 * param rather than transcoding client-side — Twilio Media Streams require
 * mu-law 8kHz outbound audio, and asking the TTS vendor to emit that
 * format natively avoids adding a resampling/codec dependency to this
 * service entirely (the "no dependency beyond what's needed" boundary from
 * this build's own scope). Single-shot synthesis (whole `text` sent as one
 * message, then flush) rather than an incrementally-fed WebSocket session:
 * each call here already synthesizes exactly one already-complete unit of
 * text — CallSessionOrchestrator now calls `synthesize()` once per
 * streamed chunk (docs/28 §C.3), not once per whole turn, but each of
 * those chunks is itself a complete natural speech segment
 * (findSpeechSegmentBoundary, voice-orchestrator) by the time it reaches
 * here, not a partial/growing string — so there is still no benefit to
 * feeding THIS adapter incrementally, only to calling it more than once
 * per turn, which the caller already does.
 *
 * `voiceSettings` (stability/similarity_boost/style/speed) is
 * CallSessionOrchestrator's own emotional-delivery layer (see
 * emotional-delivery.ts) speaking through — every `[bracket]` cue in
 * Grace's response text has ALREADY been parsed out and translated into
 * these numbers before `text` ever reaches this adapter; by design, this
 * class never sees a bracket tag itself, so there is no markup-leak risk
 * introduced here specifically (the leak risk this codebase actually
 * guards against lives entirely in emotional-delivery.ts's own
 * sanitization, which runs before this method is ever called).
 */
/**
 * Replayable audio for short utterances that recur across calls.
 *
 * FOUND measuring pickup latency for a brand-new caller. The opening line is
 * now a fixed per-business template (see buildOpeningGreeting in
 * voice-orchestrator), yet every call still paid a fresh ElevenLabs round
 * trip, roughly 400ms and occasionally 2s cold, to render audio byte-for-byte
 * identical to the previous call's. The same holds for the stock sign-offs
 * and apology lines. After the first render, those now start playing
 * immediately.
 *
 * Deliberately narrow so it can never serve wrong audio:
 *  - keyed on EVERYTHING that shapes the sound (model, voice, every delivery
 *    setting, exact text), so a different emotional delivery is a miss;
 *  - only short utterances, which are the ones that genuinely repeat;
 *  - only stored after ElevenLabs signalled the render complete (isFinal),
 *    never from a stream that was aborted by barge-in, errored, or closed
 *    early, so a truncated clip can never be cached and replayed;
 *  - bounded, least-recently-used eviction.
 *
 * Replay is safe for barge-in: the sink's Twilio `clear` event flushes
 * buffered audio whether it arrived from the network or from here, and the
 * abort signal is still honoured between chunks.
 */
const MAX_CACHEABLE_TEXT_CHARS = 240;
const MAX_CACHED_UTTERANCES = 64;

/**
 * 2026-10-23, client: "it usually takes 5 full seconds to answer". Every
 * reply opened a NEW ElevenLabs socket before it could start, and opening
 * it is the slow part. Measured from the production server: about 300 ms
 * to connect, then about 270 ms to the first audio. So one socket is always
 * opened ahead of time, and a reply starts on it.
 *
 * ElevenLabs closes an idle socket after 20 s by default (measured: closed
 * at 21 s), which is shorter than many callers talk for. `inactivity_timeout`
 * raises that, and a spare is only used while it is younger than the
 * server's own limit, with room to spare. Measured with it set: still open
 * after 70 s idle, first audio 269 ms.
 */
const INACTIVITY_TIMEOUT_S = 120;
const SPARE_MAX_AGE_MS = 100_000;

@Injectable()
export class ElevenLabsTtsProvider implements TextToSpeechProvider {
  private readonly audioCache = new Map<string, Buffer[]>();
  private spare: { url: string; socket: WebSocket; openedAt: number } | null = null;

  /** The socket opened ahead of time, if it still suits; otherwise a new one. */
  private takeSocket(url: string): WebSocket {
    const spare = this.spare;
    this.spare = null;
    if (
      spare &&
      spare.url === url &&
      (spare.socket.readyState === WebSocket.OPEN ||
        spare.socket.readyState === WebSocket.CONNECTING) &&
      Date.now() - spare.openedAt < SPARE_MAX_AGE_MS
    ) {
      return spare.socket;
    }
    if (spare && spare.socket.readyState === WebSocket.OPEN) {
      spare.socket.close();
    }
    return new WebSocket(url);
  }

  /** Opens the socket the NEXT reply will start on, unless one is already waiting. */
  private prepareSpare(url: string): void {
    if (this.spare) {
      return;
    }
    const socket = new WebSocket(url);
    // A spare that fails is simply not used (see takeSocket); its error must
    // not surface as an unhandled event.
    socket.on("error", () => undefined);
    this.spare = { url, socket, openedAt: Date.now() };
  }

  async *synthesize(
    text: string,
    signal?: AbortSignal,
    voiceSettings: VoiceDeliverySettings = DEFAULT_VOICE_DELIVERY_SETTINGS,
  ): AsyncIterable<Buffer> {
    const apiKey = process.env["ELEVENLABS_API_KEY"];
    const voiceId = process.env["ELEVENLABS_VOICE_ID"];
    if (!apiKey) {
      throw new Error("ELEVENLABS_API_KEY is not configured");
    }
    if (!voiceId) {
      throw new Error("ELEVENLABS_VOICE_ID is not configured");
    }
    const modelId = process.env["ELEVENLABS_MODEL_ID"] ?? "eleven_turbo_v2_5";

    const cacheKey =
      text.length <= MAX_CACHEABLE_TEXT_CHARS
        ? [
            modelId,
            voiceId,
            voiceSettings.stability,
            voiceSettings.similarityBoost,
            voiceSettings.style,
            voiceSettings.speed,
            text,
          ].join("|")
        : null;
    const url = `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input?output_format=ulaw_8000&model_id=${modelId}&inactivity_timeout=${INACTIVITY_TIMEOUT_S}`;
    const cached = cacheKey ? this.audioCache.get(cacheKey) : undefined;
    if (cacheKey && cached) {
      // A replayed clip (the greeting, mostly) is where a call starts, so the
      // caller's first answer gets a socket that is already open.
      this.prepareSpare(url);
      // Refresh recency for LRU eviction.
      this.audioCache.delete(cacheKey);
      this.audioCache.set(cacheKey, cached);
      for (const chunk of cached) {
        if (signal?.aborted) {
          return;
        }
        yield chunk;
      }
      return;
    }

    const socket = this.takeSocket(url);
    const recorded: Buffer[] = [];
    let renderCompleted = false;

    const queue = new AudioChunkQueue();
    let opened = false;

    const start = (): void => {
      opened = true;
      socket.send(
        JSON.stringify({
          text: " ",
          voice_settings: {
            stability: voiceSettings.stability,
            similarity_boost: voiceSettings.similarityBoost,
            style: voiceSettings.style,
            speed: voiceSettings.speed,
          },
          xi_api_key: apiKey,
        }),
      );
      socket.send(JSON.stringify({ text: `${text} `, flush: true }));
      // Documented end-of-stream signal — an empty-text message tells
      // ElevenLabs no more input is coming, so it finalizes and closes
      // rather than this adapter guessing a fixed timeout.
      socket.send(JSON.stringify({ text: "" }));
    };
    if (socket.readyState === WebSocket.OPEN) {
      start();
    } else {
      socket.on("open", start);
    }

    socket.on("message", (data: WebSocket.RawData) => {
      // Same reasoning as DeepgramSttSession.handleMessage: ElevenLabs'
      // audio-chunk events are always JSON text frames, `Buffer.concat`
      // avoids relying on Array's default stringification for the
      // (unused-in-practice) fragmented-binary-frame union member.
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
      if (typeof message["audio"] === "string") {
        queue.push(Buffer.from(message["audio"], "base64"));
      }
      if (message["isFinal"] === true) {
        renderCompleted = true;
        queue.end();
      }
    });

    socket.on("close", () => queue.end());
    socket.on("error", (error: Error) => queue.fail(error));

    const onAbort = (): void => {
      socket.close();
      queue.end();
    };
    signal?.addEventListener("abort", onAbort);

    try {
      for await (const chunk of queue) {
        if (signal?.aborted) {
          break;
        }
        if (cacheKey) {
          recorded.push(chunk);
        }
        yield chunk;
      }
      if (cacheKey && renderCompleted && !signal?.aborted && recorded.length > 0) {
        this.audioCache.set(cacheKey, recorded);
        if (this.audioCache.size > MAX_CACHED_UTTERANCES) {
          const oldest = this.audioCache.keys().next().value;
          if (oldest !== undefined) {
            this.audioCache.delete(oldest);
          }
        }
      }
    } finally {
      signal?.removeEventListener("abort", onAbort);
      if (opened && socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
      this.prepareSpare(url);
    }
  }
}

/**
 * Bridges ElevenLabs' event-driven `ws` message callbacks into an
 * `AsyncIterable<Buffer>` — the shape `TextToSpeechProvider.synthesize`
 * promises callers (the call-session turn-speaking loop awaits chunks with
 * `for await`, it does not register callbacks). A minimal hand-rolled
 * async queue rather than pulling in an events-to-async-iterator library
 * for one adapter.
 */
class AudioChunkQueue implements AsyncIterable<Buffer> {
  private readonly buffered: Buffer[] = [];
  private readonly waiters: Array<{
    resolve: (result: IteratorResult<Buffer>) => void;
    reject: (error: Error) => void;
  }> = [];
  private ended = false;
  private error: Error | null = null;

  push(chunk: Buffer): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve({ value: chunk, done: false });
    } else {
      this.buffered.push(chunk);
    }
  }

  end(): void {
    this.ended = true;
    while (this.waiters.length > 0) {
      this.waiters.shift()?.resolve({ value: undefined, done: true });
    }
  }

  /**
   * A waiter already parked in `next()` when this fires must see the
   * rejection, not a silent `done: true` — `end()` alone would resolve it as
   * a clean end-of-stream, masking the actual ElevenLabs socket error from
   * the `for await` loop in `synthesize()`.
   */
  fail(error: Error): void {
    this.error = error;
    this.ended = true;
    while (this.waiters.length > 0) {
      this.waiters.shift()?.reject(error);
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<Buffer> {
    return {
      next: (): Promise<IteratorResult<Buffer>> => {
        if (this.error) {
          return Promise.reject(this.error);
        }
        const next = this.buffered.shift();
        if (next) {
          return Promise.resolve({ value: next, done: false });
        }
        if (this.ended) {
          return Promise.resolve({ value: undefined, done: true });
        }
        return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
      },
    };
  }
}
