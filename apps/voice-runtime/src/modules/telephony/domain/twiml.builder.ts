/**
 * Hand-built TwiML strings — no `twilio` SDK dependency for what is two
 * small XML templates, matching this build's "no dependency beyond what's
 * needed" boundary. `<Connect><Stream>` (not `<Start><Stream>`) is
 * deliberate: `<Start><Stream>` opens a ONE-WAY stream (Twilio -> this
 * service only) and the call continues in parallel on its own TwiML path,
 * which has no mechanism for THIS service to then send audio back —
 * Twilio's docs are explicit that bidirectional audio (required here: we
 * must send TTS back to the caller) needs `<Connect><Stream>`, which
 * hands the ENTIRE call over to the WebSocket for its duration. This is
 * the one telephony-protocol research point in this build worth flagging
 * as a specific, deliberate choice rather than an arbitrary pick between
 * two superficially similar tags.
 */
/**
 * `callParameters` round-trips everything the WebSocket handler needs but
 * has no other way to learn: Twilio's `start` event on the Media Stream
 * carries back whatever `<Parameter>` values were set here as
 * `start.customParameters`, but nothing about the ORIGINAL webhook request
 * (tenantId/businessId already resolved from `toNumber`, the callId this
 * runtime generated, callerAni, timezone) — the WebSocket connection is a
 * fresh HTTP upgrade Twilio initiates separately, not a continuation of the
 * webhook request/response that produced this TwiML.
 */
export function buildConnectStreamTwiml(options: {
  websocketUrl: string;
  callParameters: Record<string, string>;
}): string {
  const escapedUrl = escapeXml(options.websocketUrl);
  const params = Object.entries(options.callParameters)
    .map(([name, value]) => `<Parameter name="${escapeXml(name)}" value="${escapeXml(value)}" />`)
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response>` +
    `<Connect>` +
    `<Stream url="${escapedUrl}">${params}</Stream>` +
    `</Connect>` +
    `</Response>`
  );
}

/**
 * The kill-switch TwiML (env.schema.ts's `AI_RECEPTIONIST_ENABLED=false`
 * path) — unconditionally forwards the call to a human number/queue,
 * never touching tenant resolution, the AI, or the media stream at all.
 * Twilio's built-in `<Dial>` (not `<Connect><Stream>`) is deliberate: this
 * is the fallback path an operator reaches for specifically BECAUSE
 * something upstream (this platform's own backend, a bad deploy, an
 * incident) might be unhealthy — it must not depend on any of that being
 * healthy to work, the identical reasoning buildApologyTwiml's own comment
 * gives for using `<Say>` instead of ElevenLabs there.
 */
export function buildDialHumanTwiml(destinationE164: string): string {
  const escaped = escapeXml(destinationE164);
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response>` +
    `<Dial>${escaped}</Dial>` +
    `</Response>`
  );
}

/** A short static apology TwiML, used only when call-start (POST /conversations) itself fails — docs/28 §J step 2's "fallback routing, an apology message via a static TTS clip" is explicitly this runtime's own production decision to make, not voice-orchestrator's. Twilio's built-in <Say> (not ElevenLabs) is deliberate here: if the platform's own backend is unreachable, this is the one message that must not depend on that same backend chain being healthy. */
export function buildApologyTwiml(): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response>` +
    `<Say>We're sorry, we're unable to take your call right now. Please try again shortly.</Say>` +
    `<Hangup/>` +
    `</Response>`
  );
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
