import {
  DEFAULT_VOICE_DELIVERY_SETTINGS,
  type TextToSpeechProvider,
  type VoiceDeliverySettings,
} from "../../domain/text-to-speech.port";

/**
 * Hand-written fake — yields a fixed number of small fake audio chunks per
 * call rather than any real synthesis, and honors an AbortSignal exactly
 * like the real ElevenLabs adapter must (stops yielding promptly), so
 * barge-in-during-TTS tests can assert on partial playback.
 */
export class FakeTextToSpeechProvider implements TextToSpeechProvider {
  readonly synthesizeCalls: string[] = [];
  /** Parallel to `synthesizeCalls` (same index) — the voice settings each call actually received, so emotional-delivery tests can assert on the resolved stability/style/speed, not just the spoken text. */
  readonly voiceSettingsCalls: VoiceDeliverySettings[] = [];
  chunksPerCall = 3;
  /** Delay (ms) before each chunk — 0 by default so unit tests run instantly; a test can raise this to create a window for an abort signal to fire mid-stream. */
  chunkDelayMs = 0;
  /** When set, synthesize throws this instead of yielding — simulates ElevenLabs failure. */
  failNextWith: Error | null = null;

  async *synthesize(
    text: string,
    signal?: AbortSignal,
    voiceSettings: VoiceDeliverySettings = DEFAULT_VOICE_DELIVERY_SETTINGS,
  ): AsyncIterable<Buffer> {
    this.synthesizeCalls.push(text);
    this.voiceSettingsCalls.push(voiceSettings);
    if (this.failNextWith) {
      const error = this.failNextWith;
      this.failNextWith = null;
      throw error;
    }
    for (let i = 0; i < this.chunksPerCall; i++) {
      if (signal?.aborted) {
        return;
      }
      if (this.chunkDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.chunkDelayMs));
      }
      if (signal?.aborted) {
        return;
      }
      yield Buffer.from(`chunk-${i}`);
    }
  }
}
