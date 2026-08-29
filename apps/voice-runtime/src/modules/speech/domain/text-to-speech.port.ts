/**
 * Streaming synthesis, not request/response-a-whole-clip — the first audio
 * chunk must reach Twilio well before the full sentence is synthesized, or
 * the caller hears dead air. `signal` is this port's interruption/
 * cancellation mechanism (barge-in cuts TTS immediately, docs/28 §B.3):
 * an aborted signal must stop the async iterable promptly, not drain to
 * completion.
 */
export interface TextToSpeechProvider {
  /** Yields raw audio chunks already encoded in the format Twilio's Media Stream expects (mu-law 8kHz) — see elevenlabs-tts.adapter.ts's own comment on why the encoding is requested from the vendor directly rather than transcoded here. */
  synthesize(text: string, signal?: AbortSignal): AsyncIterable<Buffer>;
}

export const TEXT_TO_SPEECH_PROVIDER = Symbol("TEXT_TO_SPEECH_PROVIDER");
