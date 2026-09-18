/**
 * "The caller has said goodbye and is now waiting for the line to drop."
 *
 * FOUND LIVE on call 6d3893a0: the caller said "bye", Grace said "Take
 * care, Akash.", the caller said "bye" a second time, Grace said "Bye!",
 * and only then did the caller give up and hang up themselves. Nothing in
 * this runtime has ever ended a call from its own side, so every single
 * call so far has ended in `caller_hangup` — including the ones that were
 * conversationally over half a minute earlier. A human receptionist hangs
 * up when the other person says goodbye; this is that.
 *
 * DELIBERATELY CONSERVATIVE, because the cost of the two errors is wildly
 * asymmetric. A missed farewell costs a few awkward seconds and the caller
 * hangs up as they always have. A FALSE farewell cuts off a live human
 * mid-call, which on an emergency plumbing line is the worst thing this
 * service can do. So all three of these must hold:
 *
 *   1. the utterance is short (a real sign-off is; "let me say bye to my
 *      wife and I'll call you back" is not),
 *   2. it actually contains a sign-off phrase, and
 *   3. it contains no word that signals the conversation is still going.
 *
 * Guard (3) is what makes "don't say bye yet" and "before you go, one
 * more thing" safe. Everything unmatched simply continues the call.
 */

const MAX_FAREWELL_WORDS = 5;

/** Matched as whole words against the normalized utterance. Multi-word entries are matched as phrases. */
const FAREWELL_PHRASES = [
  "bye",
  "byebye",
  "bye bye",
  "goodbye",
  "good bye",
  "see ya",
  "see you",
  "see you later",
  "talk to you later",
  "catch you later",
  "take care",
  "have a good day",
  "have a good night",
  "have a good one",
  "that is all",
  "thats all",
];

/**
 * Any of these anywhere in the utterance vetoes the farewell outright. A
 * caller who is negating, deferring, or adding something is still in the
 * conversation no matter how the sentence happens to end.
 */
const CONTINUATION_WORDS = [
  "dont",
  "do not",
  "not",
  "no",
  "wait",
  "hold on",
  "before",
  "but",
  "actually",
  "one more",
  "another",
  "also",
  "question",
  "sorry",
  "hello",
  "hey",
  "yet",
  "still",
];

/** Lowercase, strip everything that is not a letter/digit/space, collapse whitespace. */
function normalize(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function containsPhrase(haystackWords: readonly string[], phrase: string): boolean {
  const needle = phrase.split(" ");
  for (let i = 0; i + needle.length <= haystackWords.length; i++) {
    if (needle.every((word, offset) => haystackWords[i + offset] === word)) {
      return true;
    }
  }
  return false;
}

/**
 * Sign-offs strict enough to trust at the END of a longer sentence. Bare
 * "see you" and "that's all" are deliberately absent: at the tail of a long
 * utterance they are too often about someone else ("the technician said
 * he'd see you") to end a live call on.
 */
const TRAILING_SIGN_OFFS = [
  "bye",
  "bye bye",
  "byebye",
  "goodbye",
  "good bye",
  "take care",
  "talk to you later",
  "catch you later",
  "have a good day",
  "have a good night",
  "have a good one",
  "have a great day",
];

const ACTIVE_REQUEST_WORDS = [
  "what",
  "when",
  "where",
  "why",
  "how",
  "who",
  "can you",
  "could you",
  "would you",
  "will you",
  "do you",
  "are you",
  "is it",
];

/** Longest utterance the trailing-sign-off path will consider. */
const MAX_TRAILING_FAREWELL_WORDS = 20;

function endsWithPhrase(words: readonly string[], phrase: string): boolean {
  const needle = phrase.split(" ");
  if (needle.length > words.length) {
    return false;
  }
  const tail = words.slice(words.length - needle.length);
  return needle.every((word, index) => tail[index] === word);
}

/**
 * A sign-off the caller LEADS with. FOUND LIVE on call 9ecc6846: "bye i just
 * don't want to talk to you" is as clear a goodbye as a caller can give,
 * and it failed twice over. It was longer than the short path allows and
 * did not END on a sign-off, and its "don't" matched CONTINUATION_WORDS,
 * which exist for "don't say bye yet". When "bye" comes FIRST, a negation
 * later in the sentence is the caller explaining why they are leaving, not
 * taking the goodbye back. Bare "by" is deliberately absent: "by the way"
 * and "by tomorrow" must never end a call.
 */
const LEADING_SIGN_OFFS = [
  "bye",
  "byebye",
  "goodbye",
  "good bye",
  "ok bye",
  "okay bye",
  "alright bye",
  "all right bye",
  "thanks bye",
  "thank you bye",
];

/** The only words strong enough to veto a LEADING goodbye: the caller is plainly still going. */
const STRONG_CONTINUATION_WORDS = [
  "wait",
  "hold on",
  "hang on",
  "one more",
  "another",
  "before",
  "but",
  "actually",
  "question",
  "also",
];

function startsWithPhrase(words: readonly string[], phrase: string): boolean {
  const needle = phrase.split(" ");
  return needle.length <= words.length && needle.every((word, index) => words[index] === word);
}

export function isFarewell(rawTranscript: string): boolean {
  const normalized = normalize(rawTranscript);
  if (normalized.length === 0) {
    return false;
  }
  const words = normalized.split(" ");
  if (
    words.length <= MAX_TRAILING_FAREWELL_WORDS &&
    LEADING_SIGN_OFFS.some((phrase) => startsWithPhrase(words, phrase)) &&
    !STRONG_CONTINUATION_WORDS.some((blocker) => containsPhrase(words, blocker))
  ) {
    return true;
  }
  if (CONTINUATION_WORDS.some((blocker) => containsPhrase(words, blocker))) {
    return false;
  }
  if (words.length <= MAX_FAREWELL_WORDS) {
    return FAREWELL_PHRASES.some((phrase) => containsPhrase(words, phrase));
  }
  // FOUND LIVE on call e41dd948: "okay i will like call you after some time
  // see you bye" is twelve words, so the five-word cap above rejected it
  // outright, the call never dropped, and the caller had to say "i just said
  // bye, you were supposed to cut the call." Real people sign off in whole
  // sentences. A longer utterance still counts, but only when it genuinely
  // ENDS on an unambiguous sign-off, which is how a person actually closes.
  if (words.length > MAX_TRAILING_FAREWELL_WORDS) {
    return false;
  }
  // A long sentence that asks the agent for something is still a live
  // request, however it happens to end ("what time can you come out and
  // say bye"). Only applied on this path: a five-word "okay bye" has no
  // room to also be a question.
  if (ACTIVE_REQUEST_WORDS.some((word) => containsPhrase(words, word))) {
    return false;
  }
  return TRAILING_SIGN_OFFS.some((phrase) => endsWithPhrase(words, phrase));
}
