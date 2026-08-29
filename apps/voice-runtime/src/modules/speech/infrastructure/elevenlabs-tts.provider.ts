import { Injectable } from "@nestjs/common";
import WebSocket from "ws";
import type { TextToSpeechProvider } from "../domain/text-to-speech.port";

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
 * message, then flush) rather than incremental multi-chunk sends: a turn's
 * `responseText` already arrives as one complete string from
 * voice-orchestrator (docs/28 §K: "speak responseText from the response"),
 * so there is no incremental text source to stream INTO this adapter.
 */
@Injectable()
export class ElevenLabsTtsProvider implements TextToSpeechProvider {
  async *synthesize(text: string, signal?: AbortSignal): AsyncIterable<Buffer> {
    const apiKey = process.env["ELEVENLABS_API_KEY"];
    const voiceId = process.env["ELEVENLABS_VOICE_ID"];
    if (!apiKey) {
      throw new Error("ELEVENLABS_API_KEY is not configured");
    }
    if (!voiceId) {
      throw new Error("ELEVENLABS_VOICE_ID is not configured");
    }
    const modelId = process.env["ELEVENLABS_MODEL_ID"] ?? "eleven_turbo_v2_5";

    const url = `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input?output_format=ulaw_8000&model_id=${modelId}`;
    const socket = new WebSocket(url);

    const queue = new AudioChunkQueue();
    let opened = false;

    socket.on("open", () => {
      opened = true;
      socket.send(
        JSON.stringify({
          text: " ",
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
          xi_api_key: apiKey,
        }),
      );
      socket.send(JSON.stringify({ text: `${text} `, flush: true }));
      // Documented end-of-stream signal — an empty-text message tells
      // ElevenLabs no more input is coming, so it finalizes and closes
      // rather than this adapter guessing a fixed timeout.
      socket.send(JSON.stringify({ text: "" }));
    });

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
        yield chunk;
      }
    } finally {
      signal?.removeEventListener("abort", onAbort);
      if (opened && socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
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
