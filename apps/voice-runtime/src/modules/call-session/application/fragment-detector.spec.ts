import {
  addressStillComing,
  fragmentStrength,
  isPartialNumberUtterance,
  looksLikeIncompleteFragment,
} from "./fragment-detector";

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

  describe("client feedback: a number said in groups is not cut off mid-way (vendor calls Oct 4 and Oct 7)", () => {
    // "nine three one one" used to be listed as a complete utterance. A bare
    // 4-digit run is more often the first part of a ZIP or an address than a
    // whole answer, and cutting a caller off mid-ZIP was a real failure, so it
    // is now held (up to 4 s) for the rest.
    it("holds a bare 4-digit run that used to be treated as complete", () => {
      expect(fragmentStrength("nine three one one")).toBe("strong");
    });

    it.each([
      ["nine eight", "strong"],
      ["two oh six", "strong"],
      ["206 409", "strong"],
      ["3810", "strong"],
      ["nine eight one one", "strong"],
    ])("holds the partial number %p", (utterance, expected) => {
      expect(fragmentStrength(utterance)).toBe(expected);
    });

    it.each([
      ["98119"],
      ["nine eight one one nine"],
      ["206 409 2093"],
      ["it's 98119"],
      ["s u d e e t"],
    ])("does not hold %p (complete number, or not only digits)", (utterance) => {
      expect(fragmentStrength(utterance)).toBe("none");
    });

    /**
     * 2026-10-22 tester call, twice: "I said 4512, it only registered 512."
     * Deepgram endpointed after the first digit, so "four" committed as a
     * turn of its own and the house number the model saw started at the
     * second digit. A lone digit used to be the one numeric utterance
     * treated as finished.
     */
    it.each([["four"], ["4"], ["two"]])(
      "holds the lone digit %p briefly, so a house number cannot lose its first digit",
      (utterance) => {
        expect(fragmentStrength(utterance)).toBe("weak");
      },
    );
  });

  it("2026-10-14: a spelled name ending in the letter 'a' is complete, not a trailing article", () => {
    expect(fragmentStrength("marisa m a r i s a")).toBe("none");
    expect(fragmentStrength("it's a")).toBe("strong");
  });

  it("2026-10-14: a sentence ending in 'from' is a complete answer, not held as a fragment", () => {
    // Real test call: "I don't know where from." got held the full
    // STRONG_FRAGMENT_HOLD_MS (4s) as an unfinished sentence, reading to
    // the caller as the CSR pausing and not responding right after they
    // answered a question — "from" very commonly ends a complete spoken
    // sentence in this domain, unlike the other trailing words here.
    expect(fragmentStrength("I don't know where from.")).toBe("none");
    expect(fragmentStrength("that's who it's from")).toBe("none");
  });
});

/**
 * 2026-10-22, client call: "there is a significant delay between when I
 * finish speaking and when I receive a response". A house number was the
 * worst case: four digits is a partial number (neither a ZIP nor a phone),
 * so it took the full four-second STRONG hold before the turn even started.
 */
describe("isPartialNumberUtterance", () => {
  it.each([["four five one two"], ["4512"], ["one one two four six zero three"], ["nine eight"]])(
    "marks %p as a number being read, for the shorter hold",
    (said) => {
      expect(isPartialNumberUtterance(said)).toBe(true);
    },
  );

  it.each([
    // A complete ZIP or phone is not held at all.
    ["nine eight zero three two"],
    ["two zero six five five five zero one four seven"],
    // An unfinished SENTENCE still gets the long hold: the caller is
    // genuinely mid-thought, which is a different problem.
    ["i was fixing my"],
    ["can you"],
    ["my sink is leaking"],
  ])("does not mark %p", (said) => {
    expect(isPartialNumberUtterance(said)).toBe(false);
  });
});

/**
 * FOUND ON A LIVE CALL, 2026-10-22, on the current build. The caller's name
 * was not being heard, so they announced a spelling, and the transcript
 * committed after two letters:
 *   caller: "i'm gonna spell out my name s y"
 *   Grace:  "Got it, Josh, spelled J-O-S-H."
 * Grace asserted a guessed spelling over letters the caller was still giving.
 */
describe("a spelling that has only just started", () => {
  it.each([
    ["i'm gonna spell out my name s y"],
    ["let me spell it j"],
    ["my name is spelled s y u"],
    ["it's j o"],
    // 2026-10-23 client call: cut off here, and Grace said "Your name is Qvist".
    ["the last name is lindquist l i n d"],
  ])("holds %p so the rest of the letters can arrive", (said) => {
    expect(fragmentStrength(said)).toBe("strong");
  });

  it.each([
    // The 2026-10-14 case this must not break: a COMPLETE spelling, which
    // held as a fragment left Grace saying only "Mm-hm" and then "I'm still
    // here".
    ["marisa m a r i s a"],
    ["s u m a l i a"],
    ["lindquist l i n d q u i s t"],
    ["my sink is leaking"],
    ["yes that's right"],
  ])("still treats %p as finished", (said) => {
    expect(fragmentStrength(said)).toBe("none");
  });
});

/** 2026-10-23 client: "it usually takes 5 full seconds to answer". Real lines that sat in the 4 s hold. */
describe("a complete sentence that ends on a particle is not held", () => {
  it.each([
    ["it only happens when i turn the water on"],
    ["i'm not an emergency but i'd like to get it looked at"],
    ["i think it's time to replace it i wanted to find out what my options are"],
    ["what did you say my name was"],
  ])("answers %p straight away", (said) => {
    expect(fragmentStrength(said)).toBe("none");
  });

  it.each([
    ["could you tell me what that charge is for"],
    ["is that something you can help me with"],
  ])("gives %p only the short hold", (said) => {
    expect(fragmentStrength(said)).toBe("weak");
  });

  it.each([
    ["yes the address is"],
    ["my service address is"],
    ["the last name is"],
    ["i'm at"],
    ["hi chris i actually am calling because i want to"],
    ["hi i was looking to get a water heater replaced for me and"],
    ["by the way do you know that my full name is"],
  ])("still holds %p, which is unfinished", (said) => {
    expect(fragmentStrength(said)).toBe("strong");
  });
});

/**
 * 2026-10-23 client call: an address read in six pieces, each answered by
 * Grace and talked over, heard as her voice "getting broken again and again".
 */
describe("addressStillComing", () => {
  const asked = "Could you also let me know your service address, please?";

  it.each([
    ["yes my address is one"],
    ["yes my address is one triple four"],
    ["yes my address is one triple four north avenue"],
    ["yes my address is one triple four north avenue sixtieth street"],
    ["westlake avenue unit four"],
    ["well the house number is one seven four eight and it's"],
  ])("waits for the rest after %p", (said) => {
    expect(addressStillComing(said, asked)).toBe(true);
  });

  it.each([
    // A ZIP closes the address: answered at once.
    ["yes my address is one triple four north sixtieth street nine eight two zero one"],
    ["it's 4512 maple street 98032"],
    // Nothing address-like yet.
    ["okay give me a second"],
    ["yes"],
  ])("does not wait after %p", (said) => {
    expect(addressStillComing(said, asked)).toBe(false);
  });

  it("does not hold a yes to Grace's own readback, even one that repeats the street", () => {
    const readback = "Is that 2210 Queen Anne Avenue North, 98109? Is that correct?";
    expect(addressStillComing("oh yes", readback)).toBe(false);
    expect(
      addressStillComing("yeah that's correct twenty two ten queen anne avenue north", readback),
    ).toBe(false);
  });

  it("does not hold a whole street given in answer to a street-only question", () => {
    expect(
      addressStillComing(
        "one four one zero one interurban avenue south",
        "What's the house number and street name?",
      ),
    ).toBe(false);
  });

  it.each([
    [
      "it's four thousand five hundred twelve fremont place north seattle washington ninety eight one oh three",
    ],
    [
      "it's eleven thirty three east pike street seattle washington ninety eight thousand one hundred twenty two",
    ],
    ["thirty three ninety fremont avenue north seattle washington nine eight one oh three"],
  ])("treats %p as finished: it ends on a ZIP, however the ZIP was said", (said) => {
    expect(addressStillComing(said, "What's the address for the kitchen sink issue?")).toBe(false);
  });

  it("does not hold 'okay yes' to a readback", () => {
    expect(
      addressStillComing(
        "okay yes that is the right way",
        "Barry, at 4 North Avenue, 98201. Is that all correct?",
      ),
    ).toBe(false);
  });

  it("only applies when an address is what is being given", () => {
    expect(addressStillComing("it started about two weeks ago", "When did this start?")).toBe(
      false,
    );
    expect(addressStillComing("i live at four five one two", "Anything else?")).toBe(true);
  });

  it("reads 'triple four' as digits, so it holds like any partial number", () => {
    expect(fragmentStrength("triple four")).toBe("strong");
    expect(isPartialNumberUtterance("one triple four")).toBe(true);
  });
});
