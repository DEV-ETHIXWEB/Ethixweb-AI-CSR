import {
  DEFAULT_VOICE_DELIVERY_SETTINGS,
  type VoiceDeliverySettings,
} from "../../speech/domain/text-to-speech.port";

/**
 * Interprets Grace's response text for expressive delivery — the
 * production-safe answer to "give Grace ElevenLabs-style emotional
 * delivery" that does NOT require the higher-latency ElevenLabs v3
 * dialogue endpoint (see text-to-speech.port.ts's own comment on
 * VoiceDeliverySettings for why: ~280ms + a ~40-char/8-word minimum
 * buffer per utterance before the FIRST audio frame, versus ~75ms on the
 * `stream-input` endpoint this runtime already uses — a live phone call
 * cannot absorb that on every single utterance, and docs/28 §C.3's whole
 * reason for streaming per-segment TTS in the first place was cutting
 * dead air, not reintroducing it).
 *
 * The model is prompted (prompt-layers.ts PLATFORM_BASE_PROMPT_V1 v20) to
 * write `[bracket]` delivery cues immediately before the sentence/clause
 * they apply to — e.g. `[sincere] I'm sorry you're dealing with that.` —
 * using ONLY the vocabulary in EMOTION_PROFILES below. This module:
 *
 *   1. Finds the FIRST recognized emotion cue in the given text (each
 *      call into this module already receives one already-chunked speech
 *      segment — a single sentence/clause from findSpeechSegmentBoundary,
 *      voice-orchestrator — so "first cue in the segment" and "the cue
 *      for this whole segment" are the same thing in the overwhelming
 *      common case the prompt asks for) and translates it into
 *      ElevenLabs voice_settings (stability/style/speed) for that
 *      segment's ENTIRE synthesize() call — not split up, so one segment
 *      still becomes exactly one TTS round-trip (no added latency, no
 *      extra WebSocket connections mid-sentence).
 *   2. Splits ONLY on `[pause]` cues, since a pause is a genuine
 *      mid-utterance discontinuity anyway (a real breath), into ordered
 *      sub-segments carrying an explicit silence duration to inject
 *      between them — deterministic (Buffer of mu-law silence bytes sent
 *      directly to the sink), not a hope that the TTS vendor renders a
 *      hyphen or ellipsis as a pause of any particular length.
 *   3. Strips EVERY `[bracket]`-shaped span from the text that actually
 *      reaches TTS, recognized vocabulary or not — including defending
 *      against a bare stray `[`/`]` from a malformed/unclosed tag — so an
 *      unsupported or malformed cue the model emits despite the prompt
 *      can never leak literal bracket characters into the caller's
 *      audio. This is the ONLY place in this codebase that does this;
 *      every synthesize() call (turn responses, greeting, silence
 *      check-in, apology, capacity brochure segment) flows through
 *      CallSessionOrchestrator.speak(), which is the single choke point
 *      that calls parseDelivery() before ever touching TextToSpeechProvider.
 *
 * Known, accepted limitation (documented, not silently ignored): if the
 * model places a cue AFTER the sentence it was meant for, with no
 * sentence-ending punctuation+whitespace between them (contrary to the
 * prompt's own instruction), the cue can end up attributed to the wrong
 * segment once findSpeechSegmentBoundary has already split the text
 * upstream. Cross-segment cue tracking would require carrying state
 * through the speak-queue across chunk boundaries — a materially bigger,
 * riskier change for a case the prompt already tells the model not to
 * produce. Not addressed here.
 */

/** A deliberately short, natural beat — long enough to read as an intentional pause, short enough not to read as dead air or a stall. INFERRED, not measured (same honesty convention as this file's neighbors) — roughly the length of a comma-to-next-clause breath in ordinary speech, well under SILENCE_CHECK_IN's multi-second "has the caller gone quiet" threshold, which answers a completely different question. */
export const PAUSE_TAG_SILENCE_MS = 450;

/** mu-law 8kHz silence sample value (confirmed against G.711 references: 0xFF encodes the zero-amplitude/idle signal for mu-law), 8 bytes/ms at 8000 samples/sec, 1 byte/sample. */
const MULAW_SILENCE_BYTE = 0xff;
const MULAW_BYTES_PER_MS = 8;

export function silenceBuffer(ms: number): Buffer {
  return Buffer.alloc(Math.max(0, Math.round(ms * MULAW_BYTES_PER_MS)), MULAW_SILENCE_BYTE);
}

/**
 * Named delivery profiles rather than one entry per literal cue word —
 * several of the mission's example cues are natural synonyms for the same
 * underlying delivery (e.g. "sincere"/"warmly"/"gentle" all read as warm,
 * low-stability, slightly-slower delivery) and sharing a profile keeps
 * the numbers consistent instead of eighteen independently-tuned, easily
 * drifting values. `similarityBoost` is deliberately never adjusted per
 * emotion — it controls how closely the output matches the cloned/library
 * voice's own timbre, not delivery style; changing it per-tag risks the
 * voice sounding like a different person mid-call, not just a different
 * mood. All values are INFERRED starting points (ElevenLabs' own
 * documented ranges: stability/style 0-1, speed 0.7-1.2), not tuned
 * against real audio in this environment — see this build's real-call
 * verification section for how far that testing could actually go here.
 */
type DeliveryProfile = Partial<Pick<VoiceDeliverySettings, "stability" | "style" | "speed">>;

const WARM_REASSURING: DeliveryProfile = { stability: 0.35, style: 0.4, speed: 0.97 };
const CALM_SERIOUS: DeliveryProfile = { stability: 0.65, style: 0.12, speed: 0.92 };
const THOUGHTFUL_CURIOUS: DeliveryProfile = { stability: 0.5, style: 0.25, speed: 1 };
const QUIET_SUBDUED: DeliveryProfile = { stability: 0.6, style: 0.08, speed: 0.9 };
const CONFIDENT_STEADY: DeliveryProfile = { stability: 0.55, style: 0.18, speed: 1 };
const RELIEVED_UPBEAT: DeliveryProfile = { stability: 0.4, style: 0.35, speed: 1.03 };

const EMOTION_PROFILES: Record<string, DeliveryProfile> = {
  sincere: WARM_REASSURING,
  warmly: WARM_REASSURING,
  warm: WARM_REASSURING,
  gentle: WARM_REASSURING,
  reassuring: WARM_REASSURING,
  softly: { ...QUIET_SUBDUED, style: 0.15 },
  serious: CALM_SERIOUS,
  concerned: CALM_SERIOUS,
  calm: CALM_SERIOUS,
  curious: THOUGHTFUL_CURIOUS,
  thoughtful: THOUGHTFUL_CURIOUS,
  building: { stability: 0.45, style: 0.3, speed: 1.03 },
  confident: CONFIDENT_STEADY,
  relieved: RELIEVED_UPBEAT,
  frustrated: QUIET_SUBDUED,
  tired: { ...QUIET_SUBDUED, speed: 0.88 },
  quiet: QUIET_SUBDUED,
  // Not a true rendered sigh sound — that requires ElevenLabs' higher-
  // latency v3 dialogue endpoint (see this file's own top comment). Here
  // it's approximated as a subdued, slightly slower delivery, honestly
  // short of the real thing.
  sighs: { ...QUIET_SUBDUED, speed: 0.9 },
  slower: { speed: 0.85 },
};

const PAUSE_WORD = "pause";

/**
 * A FACTORY, not a shared regex constant — deliberately. `resolveVoiceSettings`
 * and `parseDelivery` both iterate a tag pattern via `exec()`/`lastIndex`
 * over the OUTER `raw` string, while `stripAllTags` (called on each
 * flushed sub-buffer, FROM INSIDE that same outer iteration) uses
 * `.replace()` with a tag pattern of its own over a DIFFERENT, shorter
 * string. A single shared `RegExp` object's `lastIndex` is mutable,
 * global, stateful — reusing the SAME object for both would let the
 * inner `.replace()` call silently reset the outer loop's `lastIndex`
 * (found live in this file's own test suite: it hung/OOM'd, an infinite
 * loop re-matching the same early tag forever). Every call site gets its
 * OWN fresh RegExp instance instead, so there is no shared mutable state
 * to corrupt. Bounded content length (`{0,60}`) so a pathological input
 * (e.g. actual unbalanced brackets repeated many times) can't make a scan
 * expensive; no legitimate delivery cue is anywhere near 60 characters.
 */
function newTagPattern(): RegExp {
  return /\[([^[\]]{0,60})\]/g;
}

export interface DeliverySegment {
  /** Fully tag-stripped — the only thing ever passed to TextToSpeechProvider.synthesize(). */
  text: string;
  /** Silence to send to the sink immediately before this segment's own synthesize() call — 0 for the first segment unless the text itself opened with a [pause]. */
  pauseBeforeMs: number;
}

export interface ParsedDelivery {
  voiceSettings: VoiceDeliverySettings;
  /** Always has at least one entry when the input had any non-whitespace content; empty when the input was blank (nothing to speak). */
  segments: DeliverySegment[];
}

/** Removes every well-formed [tag], then defensively strips any stray bracket character left behind by a malformed/unclosed tag — see this file's own top comment on why the second pass exists. Replaces with a single space (not empty string) so words on either side of a tag never glue together. */
function stripAllTags(text: string): string {
  return text
    .replace(newTagPattern(), " ")
    .replace(/[[\]]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function resolveVoiceSettings(raw: string): VoiceDeliverySettings {
  const tagPattern = newTagPattern();
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(raw)) !== null) {
    const words = match[1]!
      .split(",")
      .map((word) => word.trim().toLowerCase())
      .filter((word) => word.length > 0);
    let profile: DeliveryProfile = {};
    let matchedAny = false;
    for (const word of words) {
      const found = EMOTION_PROFILES[word];
      if (found) {
        matchedAny = true;
        profile = { ...profile, ...found };
      }
    }
    if (matchedAny) {
      return {
        ...DEFAULT_VOICE_DELIVERY_SETTINGS,
        ...profile,
      };
    }
    // A [pause]-only tag (or any other unrecognized tag) carries no
    // delivery-style information of its own — keep scanning for the
    // first tag that actually resolves to a known emotion profile.
  }
  return DEFAULT_VOICE_DELIVERY_SETTINGS;
}

export function parseDelivery(raw: string): ParsedDelivery {
  const voiceSettings = resolveVoiceSettings(raw);
  const segments: DeliverySegment[] = [];

  const tagPattern = newTagPattern();
  let cursor = 0;
  let pendingPauseMs = 0;
  let match: RegExpExecArray | null;

  const flush = (endIndex: number): void => {
    const buffer = stripAllTags(raw.slice(cursor, endIndex));
    if (buffer.length > 0) {
      segments.push({ text: buffer, pauseBeforeMs: pendingPauseMs });
      pendingPauseMs = 0;
    }
    cursor = endIndex;
  };

  while ((match = tagPattern.exec(raw)) !== null) {
    const words = match[1]!
      .split(",")
      .map((word) => word.trim().toLowerCase())
      .filter((word) => word.length > 0);
    if (words.includes(PAUSE_WORD)) {
      flush(match.index);
      cursor = tagPattern.lastIndex;
      pendingPauseMs += PAUSE_TAG_SILENCE_MS;
    }
  }
  flush(raw.length);

  return { voiceSettings, segments };
}
