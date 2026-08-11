import type { BrochureSegment, VoiceBrochureConfig } from "./capacity-config";

/**
 * Pure selection logic — no I/O, no timers. The Voice Runtime owns actual
 * playback/rotation timing (docs/36 §4/§6: segments must be interruptible
 * instantly, never block emergency detection or human handoff, and this
 * service has no channel to push audio or mid-call timing signals to the
 * runtime — it only ever returns "read state", never "control the call").
 * This function answers one question: given how long a caller has been
 * waiting, which segment should be playing right now.
 *
 * Returns null when the brochure is disabled or has no segments — callers
 * MUST treat null as "say nothing brand-specific, use a neutral short
 * phrase instead" (docs/36 §4's own example), never as an error.
 */
export function selectBrochureSegment(
  config: VoiceBrochureConfig,
  waitedMs: number,
): BrochureSegment | null {
  if (!config.enabled || config.segments.length === 0) {
    return null;
  }
  const rotationIndex = Math.floor(waitedMs / Math.max(1, config.rotationIntervalMs));
  const segment = config.segments[rotationIndex % config.segments.length];
  return segment ?? null;
}
