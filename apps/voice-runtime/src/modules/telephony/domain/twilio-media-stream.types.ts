/**
 * Twilio's documented Media Streams WebSocket protocol
 * (https://www.twilio.com/docs/voice/media-streams/websocket-messages) —
 * JSON envelope messages, each carrying a `base64`-encoded mu-law 8kHz PCM
 * payload on `media.payload`. Only the fields this service actually reads
 * are typed; Twilio sends additional metadata (customParameters,
 * mediaFormat details) this runtime does not need.
 */
export interface TwilioStartMessage {
  event: "start";
  start: {
    streamSid: string;
    callSid: string;
    accountSid: string;
    customParameters?: Record<string, string>;
  };
}

export interface TwilioMediaMessage {
  event: "media";
  streamSid: string;
  media: { payload: string; timestamp?: string };
}

export interface TwilioStopMessage {
  event: "stop";
  streamSid: string;
  stop?: { callSid: string; accountSid: string };
}

export interface TwilioMarkMessage {
  event: "mark";
  streamSid: string;
  mark: { name: string };
}

export type TwilioInboundMessage =
  | TwilioStartMessage
  | TwilioMediaMessage
  | TwilioStopMessage
  | TwilioMarkMessage
  | { event: "connected" };

export function parseTwilioMessage(raw: string): TwilioInboundMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || !("event" in parsed)) {
    return null;
  }
  return parsed as TwilioInboundMessage;
}

/** Twilio's Media Streams fixed audio format — never negotiated per-call. */
export const TWILIO_MEDIA_SAMPLE_RATE_HZ = 8000;
export const TWILIO_MEDIA_ENCODING = "mulaw" as const;

/** Builds the outbound `media` envelope Twilio's WebSocket expects for audio THIS service sends back to the caller. */
export function buildTwilioMediaMessage(streamSid: string, audioChunk: Buffer): string {
  return JSON.stringify({
    event: "media",
    streamSid,
    media: { payload: audioChunk.toString("base64") },
  });
}

/** Twilio's documented "clear buffered audio" message — sent on barge-in so audio already queued on Twilio's side stops playing immediately, not just audio this service hasn't sent yet. */
export function buildTwilioClearMessage(streamSid: string): string {
  return JSON.stringify({ event: "clear", streamSid });
}

/** Twilio echoes a `mark` event back once it has FINISHED playing all audio queued before the mark — used to know when TTS playback has actually completed, not just when this service finished sending chunks. */
export function buildTwilioMarkMessage(streamSid: string, name: string): string {
  return JSON.stringify({ event: "mark", streamSid, mark: { name } });
}
