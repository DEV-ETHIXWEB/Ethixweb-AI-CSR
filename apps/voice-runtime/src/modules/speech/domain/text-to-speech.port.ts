/**
 * ElevenLabs `voice_settings` — the levers this codebase actually has
 * available for expressive delivery WITHOUT giving up the low-latency
 * `stream-input` endpoint. True ElevenLabs v3 audio tags ([sighs],
 * [laughs], accents, sound effects) only exist on a different endpoint
 * (`text-to-dialogue/stream-input`, eleven_v3_conversational) that is
 * ~4x higher latency (~280ms vs ~75ms, per ElevenLabs' own published
 * numbers as of 2026) and requires ~40 characters/8 words buffered before
 * the first audio frame — unacceptable for a live phone call where every
 * `speak()` call must start producing audio immediately (docs/28 §C.3's
 * whole reason for existing). `stability`/`style`/`speed` on the EXISTING
 * fast endpoint give real, audible expressive range (calmer vs. more
 * emotive delivery, faster vs. slower pacing) without that tradeoff — see
 * emotional-delivery.ts's own comment for the full reasoning and the
 * mapping from [bracket] cues to these fields.
 */
export interface VoiceDeliverySettings {
  stability: number;
  similarityBoost: number;
  style: number;
  speed: number;
}

export const DEFAULT_VOICE_DELIVERY_SETTINGS: VoiceDeliverySettings = {
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0,
  speed: 1,
};

/**
 * Streaming synthesis, not request/response-a-whole-clip — the first audio
 * chunk must reach Twilio well before the full sentence is synthesized, or
 * the caller hears dead air. `signal` is this port's interruption/
 * cancellation mechanism (barge-in cuts TTS immediately, docs/28 §B.3):
 * an aborted signal must stop the async iterable promptly, not drain to
 * completion.
 */
export interface TextToSpeechProvider {
  /** Yields raw audio chunks already encoded in the format Twilio's Media Stream expects (mu-law 8kHz) — see elevenlabs-tts.adapter.ts's own comment on why the encoding is requested from the vendor directly rather than transcoded here. `voiceSettings` defaults to `DEFAULT_VOICE_DELIVERY_SETTINGS` (ElevenLabs' own defaults) when omitted — every existing caller that doesn't yet know about emotional delivery keeps its exact current sound. */
  synthesize(
    text: string,
    signal?: AbortSignal,
    voiceSettings?: VoiceDeliverySettings,
  ): AsyncIterable<Buffer>;
}

export const TEXT_TO_SPEECH_PROVIDER = Symbol("TEXT_TO_SPEECH_PROVIDER");
