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
export const MULAW_BYTES_PER_MS = 8;

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
  // Added by the orchestrator's output guard, never by the model: address and phone
  // read-backs were "not clearly hearable" (client feedback), so they are spoken
  // slower than any emotional cue ever goes.
  slowly: { speed: 0.78 },
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

/**
 * Meta-asides: the model narrating its own reasoning as a parenthetical
 * inside otherwise-speakable text. Found live on a real call (v31) — a
 * turn went out as: "...or is water coming from under the sink? (Just
 * continuing naturally with what I asked, once I've got context that this
 * is a routine repair, not an emergency.)" — and the caller HEARD the
 * parenthetical, because every existing defense here targets square
 * brackets only: `stripAllTags`, prompt-layers.ts v14's "never narrate
 * your own internal process as spoken text" rule, and its illustrating
 * example "[calling the tool]". Parentheses walked through all three.
 *
 * Same reasoning as the C1 guard in call-session-orchestrator.ts's
 * `speak()`: prompt wording alone has a reliability ceiling, so the real
 * backstop is deterministic code. The prompt half is tightened in the
 * same change; this is what makes it non-negotiable.
 *
 * WHY THE 3-WORD FLOOR, and not "strip every parenthesis": a spoken
 * utterance legitimately contains one parenthesized form — a phone area
 * code, "(206) 895-6963", which this agent reads back to callers digit by
 * digit on the confirm-the-number path. Blanket stripping would silently
 * delete the area code from a number being confirmed, turning a
 * cosmetic bug into a wrong-callback-number bug. A meta-aside is prose
 * and always runs several words; "(206)" never does. Bounded content
 * length for the same scan-cost reason `newTagPattern` documents.
 */
function stripMetaAsides(text: string): string {
  return text
    .replace(/\(([^()]{0,400})\)/g, (whole, inner: string) =>
      inner.trim().split(/\s+/).filter(Boolean).length >= 3 ? " " : whole,
    )
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Self-narration: Grace announcing that she is about to go look something
 * up, which the caller then waits through for nothing.
 *
 * FOUND LIVE on call 6d3893a0 ("Now let me look up your history with us.")
 * and again across the qa-suite run at prompt v34: "I'll look you up real
 * quick," "let me pull up your info real quick," "Actually, let me look
 * you up first," "Let me look into this for you." A lookup is instant and
 * invisible; the sentence exists only because the model is narrating its
 * own tool call, and the caller hears it the moment it is written, before
 * the tool has even run.
 *
 * This is the THIRD prompt version to try to stop it by wording alone
 * (v14, v32, v34), which is exactly the threshold this codebase's own
 * established pattern treats as "stop arguing with the model and put a
 * guard in the code" — the same reasoning as the C1 empty-utterance guard
 * in `speak()` and stripMetaAsides above.
 *
 * SCOPED TIGHTLY to announcements of a LOOKUP. Sentences that sound
 * similar but genuinely tell the caller something are deliberately left
 * alone: "let me get your information over to the team" (a real action
 * they care about), "let me make sure I've got that right" (a
 * confirmation the prompt actively wants). Only a lookup/check verb
 * triggers removal.
 */
function stripSelfNarration(text: string): string {
  const withoutLeaks = text
    .split(/(?<=[.?!])\s+/)
    .filter((sentence) => !INSTRUCTION_LEAK.test(sentence));
  // Unlike lookup narration below, a reply made ENTIRELY of instruction
  // narration must not be spoken at all. Returning nothing hands speak() its
  // existing C1 fallback, a safe short line, instead of reading the model's
  // instructions to the caller.
  if (withoutLeaks.length === 0) {
    return "";
  }
  const sentences = withoutLeaks;
  const kept = sentences
    .map((sentence) => removeNarrationSpan(sentence))
    .filter((sentence) => sentence.trim().length > 0);
  // Never strip the entire utterance away on this rule alone: if narration
  // was all there was, the words still beat silence on a live call, and
  // the `speak()` caller has no other content to fall back on.
  if (kept.length === 0) {
    return text.trim();
  }
  return kept
    .join(" ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Removes the narration SPAN from a sentence rather than the clause or the
 * sentence containing it.
 *
 * An earlier version dropped whole clauses, which required the narration to
 * begin one. The qa-suite run showed it rarely does: "Wait — before I ask
 * more, let me look up your info real quick.", "A jammed disposal. Let me
 * look at what we've done before.", "I'll get someone out to you, let me
 * just check your address." Anchoring to a clause start missed the first
 * two, and dropping the whole clause would have taken "I'll get someone out
 * to you" with it in the third. Matching from the narration verb to the end
 * of the sentence keeps the real content on either side and removes exactly
 * the announcement.
 */
function removeNarrationSpan(sentence: string): string {
  const cleaned = sentence.replace(SELF_NARRATION, " ");
  if (cleaned === sentence) {
    // Nothing matched. Return the sentence EXACTLY as written rather than
    // normalising punctuation the author chose.
    return sentence;
  }
  const tidied = cleaned
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.?!,])/g, "$1")
    .replace(/[,;]\s*([.?!])/g, "$1")
    .replace(/\s+[—–-]\s*$/, "")
    .replace(/[,;]\s*$/, "")
    .trim();
  // The span regex stops before the sentence's terminator, so a sentence
  // that was ENTIRELY narration leaves a bare "." behind. Anything with no
  // letters or digits left in it is not a sentence any more.
  if (!/[a-z0-9]/i.test(tidied)) {
    return "";
  }
  return /[.?!]$/.test(tidied) ? tidied : `${tidied}.`;
}

/**
 * A sentence that describes the call from OUTSIDE it, the model reporting
 * on its own instructions instead of talking to the person on the line.
 *
 * FOUND in the pre-deploy regression sweep, as text that would have been
 * spoken: "No problem, talk soon! The caller has said goodbye and ended the
 * call. As instructed, I let them go with a warm closing line and did not
 * ask any qualifying questions." Grace always speaks TO the caller, so "the
 * caller" in the third person, or any reference to her instructions, is
 * never something a real caller should hear. The whole sentence goes, since
 * none of it was meant for them.
 */
const INSTRUCTION_LEAK =
  /\b(the caller (has|is|was|said|wants|asked|didn'?t|did not|hung|ended)|as instructed|per my instructions|my instructions|i was instructed|following (my|the) (instructions|rules|guidelines)|system prompt)\b/i;

/**
 * A narration announcement: an opener promising an action ("let me", "I'll",
 * "I'm going to") followed within the same sentence by a lookup/check verb.
 * The TAIL is bounded the same way the gap is. "Let me check that for you
 * — what's your ZIP code?" used to match to the end of the sentence and
 * swallow the real question with the announcement, which left nothing to
 * speak and so (by the never-strip-everything guard) silently kept the
 * announcement instead. Stopping the tail at a dash or semicolon removes
 * exactly the announcement and leaves the question standing.
 *
 * The gap between the two halves deliberately cannot cross a comma,
 * semicolon or dash: without that, "I'll get someone out to you, let me
 * just check your address" matched from its very first word and took the
 * real content with it. The announcement and its verb always sit in the
 * same clause.
 *
 * BOTH halves are required, which is what keeps genuinely informative
 * sentences ("let me get your information over to the team", "let me make
 * sure I've got that right") out of its reach.
 */
const SELF_NARRATION =
  /(?:^|[,;]\s*|\s+[—–-]\s*)(?:before\s+(?:we|i)\b[^,.?!]{0,40},\s*)?(?:(?:actually|now|first|okay|alright|so|wait|but|and|then)[,\s]+)*(?:let me(?: just)?|let's|i'?ll|i will|i'?m going to|i am going to|give me (?:a|one) (?:second|moment|sec))\b[^.?!,;—–]*?\b(?:look(?:ing)?\s+(?:you|that|this|it)?\s*up|look\s+(?:at|into)\s+(?:what|this|that|it|your|our|the)|pull(?:ing)?\s+up|check\s+(?:on\s+)?(?:that|if|whether|what|our|the|your|my|a\s+couple|some)|see what we have)[^.?!—–;]*/gi;

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

export function parseDelivery(rawInput: string): ParsedDelivery {
  // Meta-asides are removed BEFORE anything else looks at the string, so
  // every downstream index (`tagPattern.lastIndex`, each `flush` cursor)
  // is computed against the one string that actually gets spoken.
  const raw = stripSelfNarration(stripMetaAsides(rawInput));
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
