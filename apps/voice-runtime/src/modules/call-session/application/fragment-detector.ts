/**
 * A conservative, evidence-based heuristic for "this short finalized
 * transcript is very unlikely to be a complete thought on its own" — see
 * call-session-orchestrator.ts's own comment on `FRAGMENT_COALESCE_WINDOW_MS`
 * for the real-call evidence this exists to close: Deepgram's own
 * endpointing (500ms of clean silence) correctly, per its own configured
 * threshold, finalized a caller's genuinely-still-forming thought multiple
 * times in one real call ("can you" / "oh sorry like" / ...), each one
 * treated as its own complete, independent turn — the caller was mid-
 * sentence, not done, for gaps as long as ~2.5s.
 *
 * Deliberately narrow, on two axes:
 *   1. Word count — only a genuinely SHORT utterance (≤4 words) is ever
 *      considered; a long, complete-sounding utterance is never delayed
 *      regardless of how it starts or ends, so this can never slow down
 *      the common case (a caller's real problem description, a full
 *      sentence, a normal answer).
 *   2. One of two concrete linguistic signals, not word count alone:
 *      - OPENING a question/request with a modal, auxiliary, or WH-word
 *        ("can", "do", "will", "what", "where", ...) — a caller
 *        essentially never leaves a bare "Can you" or "Do you" as their
 *        WHOLE utterance; a genuinely complete short answer ("yes",
 *        "no", "okay", a name, a number) essentially never starts this
 *        way either.
 *      - ENDING with a word that cannot grammatically close a sentence
 *        on its own: a determiner ("my", "the", "a"), a preposition
 *        ("to", "of", "for", "in"), a conjunction ("and", "but", "or"),
 *        or a trailing filler a speaker uses while still forming the
 *        rest of their thought ("like", "um", "uh").
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
const FRAGMENT_WORD_COUNT_MAX = 4;

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
  "is",
  "are",
  "was",
  "were",
  "am",
  "what",
  "where",
  "when",
  "why",
  "how",
  "who",
  "which",
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
  if (words.length === 0 || words.length > FRAGMENT_WORD_COUNT_MAX) {
    return false;
  }
  const first = normalizeWord(words[0]!);
  const last = normalizeWord(words[words.length - 1]!);
  return OPENING_WORDS.has(first) || TRAILING_WORDS.has(last);
}
