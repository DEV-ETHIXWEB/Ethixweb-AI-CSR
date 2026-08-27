import type { SpeechToTextProvider, SpeechToTextSession } from "../../domain/speech-to-text.port";

/**
 * Hand-written fake — no real Deepgram socket. A test drives it by calling
 * `emitFinalTranscript`/`emitSpeechStarted`/`emitError` directly rather than
 * pushing raw mu-law bytes through a decoder, matching this codebase's
 * "fake the port, not the wire protocol" convention.
 */
export class FakeSpeechToTextSession implements SpeechToTextSession {
  readonly audioFrames: Buffer[] = [];
  closed = false;
  private finalHandler: ((result: { transcript: string; confidence: number }) => void) | null =
    null;
  private speechStartedHandler: (() => void) | null = null;
  private errorHandler: ((error: Error) => void) | null = null;

  sendAudio(frame: Buffer): void {
    this.audioFrames.push(frame);
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
    this.closed = true;
  }

  /** Test helper: simulate Deepgram finalizing an utterance. */
  emitFinalTranscript(transcript: string, confidence = 0.95): void {
    this.finalHandler?.({ transcript, confidence });
  }

  /** Test helper: simulate Deepgram's VAD detecting speech onset (barge-in signal). */
  emitSpeechStarted(): void {
    this.speechStartedHandler?.();
  }

  emitError(error: Error): void {
    this.errorHandler?.(error);
  }
}

export class FakeSpeechToTextProvider implements SpeechToTextProvider {
  readonly sessions: FakeSpeechToTextSession[] = [];
  /** When set, openSession rejects with this instead of returning a session — simulates provider unavailability at call start. */
  failNextOpenWith: Error | null = null;

  async openSession(): Promise<SpeechToTextSession> {
    if (this.failNextOpenWith) {
      const error = this.failNextOpenWith;
      this.failNextOpenWith = null;
      throw error;
    }
    const session = new FakeSpeechToTextSession();
    this.sessions.push(session);
    return session;
  }
}
