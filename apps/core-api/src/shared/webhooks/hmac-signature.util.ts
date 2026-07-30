import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Shared across every inbound webhook handler (CRM, telephony, SMS-provider
 * — docs/01-architecture-overview.md §7, docs/08-security-observability-reliability.md
 * §1.3, docs/13-implementation-backlog.md "auth" module §5). Not yet wired
 * to a real webhook receiver — none exist yet (crm-integration and
 * webhook-subscriptions are later modules) — but the utility itself is
 * complete, tested, and ready for them, rather than being built ad hoc
 * once, differently, per future receiver.
 *
 * `payload` must be the RAW, unparsed request body bytes — computing the
 * HMAC over a re-serialized JSON object (even one that "looks the same")
 * can produce a different signature than what the sender computed, since
 * JSON re-serialization isn't guaranteed byte-identical (key order,
 * whitespace, number formatting). This is a documented, common real-world
 * webhook-verification bug (flagged explicitly in docs/05-crm-integration.md
 * §2.6 for the Housecall Pro case specifically) — this utility only ever
 * accepts a `Buffer`/`string` for exactly that reason, never a parsed object.
 */
export function verifyHmacSignature(
  payload: Buffer | string,
  signatureHeader: string,
  secret: string,
  algorithm: "sha256" | "sha1" = "sha256",
): boolean {
  const expected = createHmac(algorithm, secret).update(payload).digest("hex");
  const providedHex = normalizeSignature(signatureHeader);
  if (providedHex === null) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected, "hex");
  const providedBuffer = Buffer.from(providedHex, "hex");
  // Different lengths would make timingSafeEqual throw rather than return
  // false — checked explicitly so a malformed/truncated header fails
  // cleanly instead of crashing the webhook receiver.
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

/**
 * Some providers prefix the header value (e.g. `sha256=<hex>`); this
 * strips a recognized prefix if present, otherwise returns the value as-is.
 * Returns null for a value that isn't valid hex either way.
 */
function normalizeSignature(signatureHeader: string): string | null {
  const withoutPrefix = signatureHeader.replace(/^sha256=/i, "").replace(/^sha1=/i, "");
  if (!/^[0-9a-f]+$/i.test(withoutPrefix) || withoutPrefix.length % 2 !== 0) {
    return null;
  }
  return withoutPrefix;
}

/**
 * SECURITY REVIEW FINDING, explicitly recorded (not silently accepted):
 * `verifyHmacSignature` alone provides tamper-evidence, NOT replay
 * protection — a validly-signed payload captured off the wire and resent
 * later verifies exactly the same as the first time, since nothing about
 * the signature check is aware of *when* it was computed. Two independent
 * layers close this, deliberately not merged into one:
 *
 * 1. `isTimestampWithinTolerance` (below) — a generic, tested building
 *    block a future webhook receiver calls IF the specific provider
 *    embeds a timestamp (many do, e.g. as a separate header checked
 *    alongside the signature). Kept separate from signature verification
 *    itself because *how* a timestamp is embedded (a distinct header vs.
 *    part of the signed payload) is genuinely provider-specific, and
 *    Housecall Pro's exact webhook envelope is one of the still-open
 *    must-verify-before-build items (docs/05-crm-integration.md §2.9) —
 *    guessing at a specific scheme here would be encoding an unverified
 *    assumption as if it were settled.
 * 2. Provider-event-id deduplication (docs/01-architecture-overview.md
 *    §7's `webhook_events` table, `UNIQUE(provider, provider_event_id)`)
 *    — the durable, provider-agnostic backstop that works regardless of
 *    whether a given provider's scheme includes a timestamp at all. This
 *    is the layer that actually MUST exist before any real webhook
 *    receiver ships; timestamp tolerance is defense-in-depth on top of it,
 *    not a substitute for it.
 */
export function isTimestampWithinTolerance(
  timestampSeconds: number,
  toleranceSeconds: number,
  now: Date = new Date(),
): boolean {
  const nowSeconds = now.getTime() / 1000;
  return Math.abs(nowSeconds - timestampSeconds) <= toleranceSeconds;
}
