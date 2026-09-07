/**
 * A conservative, evidence-based heuristic for "this finalized transcript
 * is very unlikely to be a complete thought on its own" — see
 * call-session-orchestrator.ts's own comment on `FRAGMENT_COALESCE_WINDOW_MS`
 * for the real-call evidence this exists to close: Deepgram's own
 * endpointing (500ms of clean silence) correctly, per its own configured
 * threshold, finalized a caller's genuinely-still-forming thought multiple
 * times in one real call ("can you" / "oh sorry like" / ...), each one
 * treated as its own complete, independent turn — the caller was mid-
 * sentence, not done, for gaps as long as ~2.5s.
 *
 * Two INDEPENDENT signals, deliberately not combined behind one shared
 * gate — a v2 revision found the v1 design conflating them cost real
 * accuracy in both directions (see below):
 *
 *   1. TRAILING word — ending in a determiner ("my", "the", "a"), a
 *      preposition ("to", "of", "for", "in"), a conjunction ("and",
 *      "but", "or"), or a trailing filler ("like", "um", "uh") is
 *      grammatically incomplete REGARDLESS of how long the utterance
 *      already is — "I was trying to explain to you about the" is just
 *      as unfinished as "i was fixing my", it's simply longer. Checked
 *      with NO word-count limit for exactly that reason (v1 gated this
 *      behind the same ≤4-word cap as the opening-word check below,
 *      which meant a long trail-off never got caught at all).
 *   2. OPENING with a MODAL/auxiliary REQUEST verb ("can", "could",
 *      "do", "will", "would", "should", "shall") in a genuinely SHORT
 *      utterance (≤4 words) — a caller essentially never leaves a bare
 *      "Can you" or "Do you" as their WHOLE utterance. Deliberately
 *      narrower than v1: v1 also included the copula/"be" forms ("is",
 *      "are", "was", "were", "am") and WH-words as openers, which
 *      flagged "Are you there?" and "Is that right?" — both genuinely
 *      complete, common caller questions, one of them an EXPLICIT
 *      required test scenario ("are you there?") this codebase's own
 *      silence-check-in and dead-air handling exists to answer promptly.
 *      Delaying exactly that question by a bounded wait, right when
 *      responsiveness matters most to an uncertain caller, was a real
 *      regression v1 would have shipped. Modal request-verbs don't have
 *      this problem: nobody says "Can?" or "Will?" as a complete
 *      question on their own.
 *
 * Neither signal is proof by itself, and this will occasionally be wrong
 * in both directions — that's an accepted, bounded cost (see
 * `FRAGMENT_COALESCE_WINDOW_MS`'s own comment for what a false positive
 * actually costs: one bounded extra wait, not a lost turn), not a claim
 * of a solved, precise grammar classifier. A false negative (a real
 * fragment this doesn't catch) is simply the pre-existing behavior,
 * unchanged — this can only ever make fragmentation handling BETTER than
 * before, never worse, since it only ever adds a bounded wait to a
 * narrow subset of turns that would otherwise have committed immediately.
 */
const OPENING_WORD_COUNT_MAX = 4;

const OPENING_WORDS = new Set([
  "can",
  "could",
  "do",
  "does",
  "did",
  "will",
  "would",
  "should",
  "shall",
]);

const TRAILING_WORDS = new Set([
  "my",
  "your",
  "his",
  "her",
  "our",
  "their",
  "the",
  "a",
  "an",
  "to",
  "of",
  "for",
  "in",
  "on",
  "at",
  "with",
  "about",
  "like",
  "and",
  "but",
  "or",
  "so",
  "um",
  "uh",
]);

function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[^a-z']/g, "");
}

export function looksLikeIncompleteFragment(transcript: string): boolean {
  const words = transcript
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  if (words.length === 0) {
    return false;
  }
  const last = normalizeWord(words[words.length - 1]!);
  if (TRAILING_WORDS.has(last)) {
    return true;
  }
  if (words.length > OPENING_WORD_COUNT_MAX) {
    return false;
  }
  const first = normalizeWord(words[0]!);
  return OPENING_WORDS.has(first);
}
