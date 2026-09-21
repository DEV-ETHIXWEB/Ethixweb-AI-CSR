import { fragmentStrength, looksLikeIncompleteFragment } from "./fragment-detector";

describe("looksLikeIncompleteFragment", () => {
  it.each([
    ["can you"],
    ["Can you"],
    ["do you"],
    ["will you"],
    ["oh sorry like"],
    ["i was fixing my"],
    ["it's my"],
    ["going to the"],
    ["talking about the"],
    ["um"],
    ["so"],
  ])("REAL-CALL / MISSION EXAMPLE: %p is flagged as a likely-incomplete fragment", (transcript) => {
    expect(looksLikeIncompleteFragment(transcript)).toBe(true);
  });

  it.each([
    ["yes"],
    ["no"],
    ["yeah"],
    ["okay"],
    ["Akash"],
    ["akash kumar"],
    ["that's right"],
    ["not right now"],
    ["water heater"],
    ["nine three one one"],
    ["bye"],
    ["hello"],
  ])("MISSION EXAMPLE: %p is a genuinely complete short utterance, NOT flagged", (transcript) => {
    expect(looksLikeIncompleteFragment(transcript)).toBe(false);
  });

  /**
   * v2 revision, found by critical re-review (not a real-call report): v1
   * also opened on copula/"be" forms ("is", "are", "was", "were", "am")
   * and WH-words — which flagged "Are you there?" and "Is that right?",
   * both genuinely complete, common caller questions, one of them an
   * EXPLICIT required scenario this codebase's own silence-check-in and
   * dead-air handling exists to answer promptly (docs/28 §... "hello?" /
   * "are you still there?"). Delaying exactly that question by a bounded
   * wait, right when responsiveness matters most to an uncertain caller,
   * would have been a real regression. Modal request-verbs ("can",
   * "will", "do", ...) don't have this problem — nobody says "Can?" or
   * "Will?" as a complete question on their own, so those stay.
   */
  it.each([
    ["are you there"],
    ["is that right"],
    ["is that okay"],
    ["was that clear"],
    ["what time"],
  ])(
    "MISSION EXAMPLE / v2 fix: %p is a genuinely complete caller question — must NOT be delayed, even though it opens with a be-verb or WH-word",
    (transcript) => {
      expect(looksLikeIncompleteFragment(transcript)).toBe(false);
    },
  );

  it("REGRESSION (explicit mission scenario): 'hello' and 'are you there' both commit immediately, never delayed", () => {
    expect(looksLikeIncompleteFragment("hello")).toBe(false);
    expect(looksLikeIncompleteFragment("hello?")).toBe(false);
    expect(looksLikeIncompleteFragment("are you there")).toBe(false);
    expect(looksLikeIncompleteFragment("are you there?")).toBe(false);
  });

  /**
   * v2 revision: the TRAILING-word signal is no longer gated behind the
   * same short word-count cap as the opening-word signal — a sentence
   * ending in a determiner/preposition/conjunction/filler is exactly as
   * grammatically incomplete at 9 words as it is at 3. v1 would have
   * missed this entirely (word count > the old shared cap meant NEITHER
   * signal was ever checked).
   */
  it("a LONG utterance that trails off on an incomplete word IS still flagged — the trailing signal has no word-count limit", () => {
    expect(looksLikeIncompleteFragment("i was trying to explain to you about the")).toBe(true);
    expect(looksLikeIncompleteFragment("so basically what happened is my water heater and")).toBe(
      true,
    );
  });

  it("a long, complete-sounding utterance that does NOT trail off on an incomplete word is never flagged", () => {
    expect(looksLikeIncompleteFragment("you're still interrupting me when i'm talking")).toBe(
      false,
    );
    expect(
      looksLikeIncompleteFragment("can you please just let me finish what I was saying to you"),
    ).toBe(false);
  });

  it("empty or whitespace-only transcript is never flagged", () => {
    expect(looksLikeIncompleteFragment("")).toBe(false);
    expect(looksLikeIncompleteFragment("   ")).toBe(false);
  });

  it("is case-insensitive and punctuation-tolerant on both the opening and trailing word", () => {
    expect(looksLikeIncompleteFragment("CAN you")).toBe(true);
    expect(looksLikeIncompleteFragment("oh sorry, like")).toBe(true);
    expect(looksLikeIncompleteFragment("Oh sorry LIKE.")).toBe(true);
  });

  /**
   * REAL-CALL FINDING: forensic review of a real call where the caller
   * directly, verbally complained that Grace wasn't waiting for him to
   * finish. He was spelling "Akash" using the "LETTER for WORD" phonetic
   * convention — "k for kite", "a for apple" — each one finalized by
   * Deepgram as its own complete-sounding utterance (neither the
   * trailing- nor opening-word signal catches it) and immediately
   * committed as a standalone turn. His very next word then barged in on
   * that turn before it could finish processing, over and over. See
   * `PHONETIC_SPELLING_PATTERN`'s own comment in fragment-detector.ts.
   */
  it.each([["k for kite"], ["a for apple"], ["s for sam"], ["B for boy"], ["Z for zebra."]])(
    "REAL-CALL FINDING: %p (phonetic spelling of one letter) is flagged as a likely-incomplete fragment",
    (transcript) => {
      expect(looksLikeIncompleteFragment(transcript)).toBe(true);
    },
  );

  it("does NOT flag an ordinary sentence that happens to contain the word 'for' in the middle — only the exact single-letter 'LETTER for WORD' shape matches", () => {
    expect(looksLikeIncompleteFragment("this is for a person")).toBe(false);
    expect(looksLikeIncompleteFragment("thanks for waiting")).toBe(false);
    expect(looksLikeIncompleteFragment("looking for the water heater")).toBe(false);
  });
});

describe("fragmentStrength (client feedback: silent hold for a caller who is still talking)", () => {
  it.each([
    ["let me check on", "strong"],
    ["wrong my name is", "strong"],
    ["the issue is", "strong"],
    ["so", "strong"],
    ["can you help", "weak"],
    ["actually my", "strong"],
    ["my sink is leaking", "none"],
    ["yes I do", "none"],
    ["thank you", "none"],
  ])("%s -> %s", (text, expected) => {
    expect(fragmentStrength(text)).toBe(expected);
  });

  it("keeps looksLikeIncompleteFragment consistent with the strength", () => {
    expect(looksLikeIncompleteFragment("let me check on")).toBe(true);
    expect(looksLikeIncompleteFragment("my sink is leaking")).toBe(false);
  });
});
