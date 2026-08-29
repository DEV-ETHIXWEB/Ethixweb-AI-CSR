/**
 * A live streaming STT session over one call. Deliberately session-shaped
 * (not a single request/response method) — Deepgram's real API is a
 * persistent WebSocket a caller's audio streams into continuously, and any
 * STT vendor swap (docs/21's provider-abstraction principle) needs the same
 * "push audio frames, receive events" shape, not a call-and-response one.
 */
export interface SpeechToTextSession {
  /** Feed one inbound audio frame (Twilio Media Stream payload, decoded from base64 mu-law 8kHz — see twilio-media-frame.codec.ts). */
  sendAudio(frame: Buffer): void;
  /**
   * Fires once per FINALIZED utterance only — per docs/28 §B.2 ("Only send
   * finalized STT transcripts... There is no separate partial-transcript
   * endpoint; if your STT provider streams partials, buffer until
   * finalization on your side"). Interim/partial results are consumed
   * internally by the adapter for barge-in detection (onSpeechStarted) and
   * never surfaced here.
   */
  onFinalTranscript(handler: (result: { transcript: string; confidence: number }) => void): void;
  /** Fires on Deepgram's VAD detecting speech onset — the barge-in signal (docs/28 §B.3). Distinct from onFinalTranscript: this can fire many times before any utterance finalizes. */
  onSpeechStarted(handler: () => void): void;
  onError(handler: (error: Error) => void): void;
  close(): Promise<void>;
}

export interface SpeechToTextProvider {
  /** Opens one session for the lifetime of a call. `sampleRateHz`/`encoding` describe the audio the caller will push via sendAudio — Twilio Media Streams are fixed at 8kHz mu-law, but the parameter keeps the port honest about what it actually depends on rather than hardcoding Twilio's format inside the port. */
  openSession(options: {
    sampleRateHz: number;
    encoding: "mulaw" | "linear16";
  }): Promise<SpeechToTextSession>;
}

export const SPEECH_TO_TEXT_PROVIDER = Symbol("SPEECH_TO_TEXT_PROVIDER");
