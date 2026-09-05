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
   * finalization on your side"). Interim/partial results with real text are
   * surfaced separately via `onInterimSpeech`, for barge-in CONFIRMATION
   * only — never as a transcript a caller-facing turn is built from.
   */
  onFinalTranscript(handler: (result: { transcript: string; confidence: number }) => void): void;
  /**
   * Fires on Deepgram's VAD detecting speech onset — the raw barge-in
   * SIGNAL (docs/28 §B.3). Deliberately NOT sufficient on its own to act
   * on: this is pure voice-activity detection, fired the instant audio
   * energy crosses a threshold, with no guarantee real speech — as
   * opposed to a breath, a cough, background noise, or the caller's own
   * TTS audio echoing back — follows. `onInterimSpeech` is the
   * confirmation signal; see CallSessionOrchestrator's own comment on
   * why the two are combined rather than acting on this alone.
   */
  onSpeechStarted(handler: () => void): void;
  /**
   * Fires on the FIRST interim (non-final) STT result carrying actual
   * recognized text after a `onSpeechStarted` event — i.e., real words
   * being transcribed, not just VAD energy. FOUND LIVE: acting on
   * `onSpeechStarted` alone killed an in-flight response on every single
   * raw speech-detection blip, confirmed or not — a real call's own
   * transcript showed only 2 of 12 turns ever completing, the rest
   * aborted within 0.3-1.6s of starting. This event exists so a caller
   * can be told apart from noise before their response gets cut off.
   */
  onInterimSpeech(handler: () => void): void;
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
