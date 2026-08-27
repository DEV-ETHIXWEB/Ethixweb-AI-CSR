/**
 * The write side of a Twilio Media Stream WebSocket connection, abstracted
 * away from the concrete `ws`/Fastify-websocket connection object so
 * CallSessionOrchestrator (application layer) never imports `ws` directly
 * and can be unit-tested with a hand-written fake, matching this
 * codebase's "fake the port, not the transport" convention throughout
 * voice-orchestrator's own __fakes__ directories.
 */
export interface MediaStreamSink {
  /** Sends one outbound audio chunk to the caller (already mu-law 8kHz — see ElevenLabsTtsProvider's own comment on why no transcoding happens in this service). */
  sendAudio(chunk: Buffer): void;
  /** Twilio's documented "stop playing whatever's queued" signal — the OTHER half of a correct mid-turn barge-in alongside aborting the HTTP call itself (docs/28 §B.3): clearing audio already in Twilio's send buffer, not just audio this service hasn't produced yet. */
  clearQueuedAudio(): void;
  /** Requests a `mark` echo once Twilio has finished playing everything queued before this call — lets the orchestrator know playback actually completed, not just that chunks were sent. */
  sendMark(name: string): void;
  close(): void;
}
