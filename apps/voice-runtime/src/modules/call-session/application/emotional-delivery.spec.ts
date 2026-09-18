import { DEFAULT_VOICE_DELIVERY_SETTINGS } from "../../speech/domain/text-to-speech.port";
import { PAUSE_TAG_SILENCE_MS, parseDelivery, silenceBuffer } from "./emotional-delivery";

describe("parseDelivery", () => {
  it("plain text with no tags at all passes through completely unchanged, with default voice settings", () => {
    const result = parseDelivery("Got it, what's the issue?");
    expect(result.voiceSettings).toEqual(DEFAULT_VOICE_DELIVERY_SETTINGS);
    expect(result.segments).toEqual([{ text: "Got it, what's the issue?", pauseBeforeMs: 0 }]);
  });

  it("blank/whitespace-only input produces zero segments — nothing to speak", () => {
    expect(parseDelivery("").segments).toEqual([]);
    expect(parseDelivery("   ").segments).toEqual([]);
  });

  it("MISSION EXAMPLE: a leading [sincere, warm] tag is stripped from the spoken text and resolves to a warm delivery profile", () => {
    const result = parseDelivery("[sincere, warm]\nI'm sorry you're dealing with that.");
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]!.text).toBe("I'm sorry you're dealing with that.");
    expect(result.segments[0]!.text).not.toContain("[");
    expect(result.segments[0]!.text).not.toContain("]");
    // "sincere"/"warm" both resolve to the same warm/reassuring profile —
    // lower stability, higher style than the untagged default.
    expect(result.voiceSettings.stability).toBeLessThan(DEFAULT_VOICE_DELIVERY_SETTINGS.stability);
    expect(result.voiceSettings.style).toBeGreaterThan(DEFAULT_VOICE_DELIVERY_SETTINGS.style);
  });

  it("a mid-sentence tag with no surrounding whitespace is stripped without gluing the adjacent words together", () => {
    const result = parseDelivery("I'm sorry[sincere]that happened.");
    expect(result.segments[0]!.text).toBe("I'm sorry that happened.");
  });

  it("[pause] splits one segment into two, in order, and injects a deterministic silence gap between them — never spoken as literal text", () => {
    const result = parseDelivery("Okay, so what we can do is,[pause]let's figure it out.");
    expect(result.segments.map((s) => s.text)).toEqual([
      "Okay, so what we can do is,",
      "let's figure it out.",
    ]);
    expect(result.segments[0]!.pauseBeforeMs).toBe(0);
    expect(result.segments[1]!.pauseBeforeMs).toBe(PAUSE_TAG_SILENCE_MS);
    for (const segment of result.segments) {
      expect(segment.text).not.toMatch(/[[\]]/);
    }
  });

  it("[pause] at the very start of the text carries its silence forward to the first real segment instead of being dropped", () => {
    const result = parseDelivery("[pause] Let's get this fixed.");
    expect(result.segments).toEqual([
      { text: "Let's get this fixed.", pauseBeforeMs: PAUSE_TAG_SILENCE_MS },
    ]);
  });

  it("consecutive [pause] tags accumulate rather than each silently overwriting the last", () => {
    const result = parseDelivery("Okay.[pause][pause]Let's continue.");
    expect(result.segments).toEqual([
      { text: "Okay.", pauseBeforeMs: 0 },
      { text: "Let's continue.", pauseBeforeMs: PAUSE_TAG_SILENCE_MS * 2 },
    ]);
  });

  it("MARKUP SANITIZATION — an unsupported/unrecognized tag is still stripped from spoken text, even though it contributes no voice-setting change", () => {
    const result = parseDelivery("[excitedly] Great news!");
    expect(result.segments[0]!.text).toBe("Great news!");
    expect(result.voiceSettings).toEqual(DEFAULT_VOICE_DELIVERY_SETTINGS);
  });

  it("MARKUP SANITIZATION — multiple tags between sentences are all stripped, only the first recognized one sets voice settings", () => {
    const result = parseDelivery("[serious] Okay. [confident] Here's what I found.");
    const combined = result.segments.map((s) => s.text).join(" ");
    expect(combined).not.toMatch(/[[\]]/);
    expect(combined).toBe("Okay. Here's what I found.");
  });

  it("MARKUP SANITIZATION — an empty tag [] never leaks bracket characters", () => {
    const result = parseDelivery("Hang on[]let me check.");
    expect(result.segments[0]!.text).not.toMatch(/[[\]]/);
  });

  it("MARKUP SANITIZATION — a malformed/unclosed tag never leaks a literal bracket character into speech", () => {
    const result = parseDelivery("Let me check [sincere that for you.");
    for (const segment of result.segments) {
      expect(segment.text).not.toMatch(/[[\]]/);
    }
  });

  it("MARKUP SANITIZATION — punctuation immediately around a tag doesn't leave stray double punctuation or brackets behind", () => {
    const result = parseDelivery("Okay, [thoughtful] let's see.");
    expect(result.segments[0]!.text).toBe("Okay, let's see.");
  });

  it("a combined bracket like [frustrated, quiet] merges both words' delivery adjustments into one subdued, slower profile", () => {
    const result = parseDelivery("[frustrated, quiet] I hear you.");
    expect(result.segments[0]!.text).toBe("I hear you.");
    expect(result.voiceSettings.speed).toBeLessThan(DEFAULT_VOICE_DELIVERY_SETTINGS.speed);
  });

  it("[slower] reduces speed below the default without requiring an emotion word", () => {
    const result = parseDelivery("[slower] This next part matters.");
    expect(result.voiceSettings.speed).toBeLessThan(DEFAULT_VOICE_DELIVERY_SETTINGS.speed);
  });

  it("similarityBoost never changes per emotion tag — only stability/style/speed are modulated", () => {
    const result = parseDelivery("[serious] This is important.");
    expect(result.voiceSettings.similarityBoost).toBe(
      DEFAULT_VOICE_DELIVERY_SETTINGS.similarityBoost,
    );
  });

  // v31 regression — the exact turn that shipped to a real caller on call
  // 515d3539 (2026-09-12). Reproduces before the stripMetaAsides fix.
  it("REAL CALL REGRESSION: a narrated meta-aside in parentheses never reaches the spoken text", () => {
    const result = parseDelivery(
      "What does the leak look like, is it dripping from the spout, or is water " +
        "coming from under the sink? (Just continuing naturally with what I asked, " +
        "once I've got context that this is a routine repair, not an emergency.)",
    );
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]!.text).toBe(
      "What does the leak look like, is it dripping from the spout, or is water " +
        "coming from under the sink?",
    );
    expect(result.segments[0]!.text).not.toContain("(");
    expect(result.segments[0]!.text).not.toContain(")");
  });

  it("a phone area code in parentheses is NOT stripped — it is under the 3-word floor and callers are read these back", () => {
    const result = parseDelivery("Let me confirm that: (206) 895-6963?");
    expect(result.segments[0]!.text).toBe("Let me confirm that: (206) 895-6963?");
  });

  it("a meta-aside as the ENTIRE turn leaves nothing to speak, same as a bare cue", () => {
    expect(parseDelivery("(Calling the tool now to check on that.)").segments).toEqual([]);
  });

  it("a meta-aside mid-sentence does not glue the surrounding words together", () => {
    const result = parseDelivery("Okay (noting this is not urgent) what's the address?");
    expect(result.segments[0]!.text).toBe("Okay what's the address?");
  });

  // v34 regression — the lead-ins the model kept producing across the
  // qa-suite run even after three prompt versions banned them.
  it.each([
    [
      "Got it, a clogged kitchen sink. Let me pull up your info real quick. What's your name?",
      "Got it, a clogged kitchen sink. What's your name?",
    ],
    [
      "I'll look you up real quick. Which drain are we talking about?",
      "Which drain are we talking about?",
    ],
    [
      "Got it. Actually, let me look you up first. Is that the right number?",
      "Got it. Is that the right number?",
    ],
    ["Let me look into this for you. What's happening with it?", "What's happening with it?"],
    ["Let me check our hours for you. We do handle emergencies.", "We do handle emergencies."],
  ])("strips the lookup lead-in from %p", (input, expected) => {
    expect(parseDelivery(input).segments[0]!.text).toBe(expected);
  });

  it.each([
    "Let me get your information over to the team so they can help.",
    "Let me make sure I've got that right.",
    "I'll have someone follow up with you today.",
    "Let's get that sorted for you.",
  ])("leaves the genuinely informative sentence %p alone", (input) => {
    expect(parseDelivery(input).segments[0]!.text).toBe(input);
  });

  it("strips a narration clause without taking the real content of its sentence with it", () => {
    const result = parseDelivery(
      "Got it, Akash. A jammed disposal — let me pull up your history real quick. Is it stuck the same way as before?",
    );
    expect(result.segments[0]!.text).toBe(
      "Got it, Akash. A jammed disposal. Is it stuck the same way as before?",
    );
  });

  it("does not split hyphenated words while removing narration clauses", () => {
    const input = "We do 24/7 emergency work and I'll have someone follow-up with you.";
    expect(parseDelivery(input).segments[0]!.text).toBe(input);
  });

  // Variants the qa-suite run surfaced after the first pattern shipped.
  it.each([
    [
      "Got it, a running toilet. Let me look into your account real quick. You're not in the system yet.",
      "Got it, a running toilet. You're not in the system yet.",
    ],
    ["Let me check our service area for you. What's your zip code?", "What's your zip code?"],
    [
      "Before we get into details, let me just check that we cover your area. That zip is outside it.",
      "That zip is outside it.",
    ],
  ])("strips the lookup variant in %p", (input, expected) => {
    expect(parseDelivery(input).segments[0]!.text).toBe(expected);
  });

  // The mid-sentence forms that only span removal catches, all observed in
  // the qa-suite run against prompt v36.
  it.each([
    [
      "Akash — I've got you in the system. A jammed disposal again. Let me look at what we've done before. How's it jammed this time?",
      "Akash — I've got you in the system. A jammed disposal again. How's it jammed this time?",
    ],
    [
      "I need to get you some immediate help. Let me check what we're working with here. What's your name?",
      "I need to get you some immediate help. What's your name?",
    ],
    [
      "Wait — before I ask more, let me look up your info real quick. What's your name?",
      "Wait. What's your name?",
    ],
  ])("removes a narration span that does not start its own clause: %p", (input, expected) => {
    expect(parseDelivery(input).segments[0]!.text).toBe(expected);
  });

  it("keeps the real content on BOTH sides of a removed narration span", () => {
    const result = parseDelivery("I'll get someone out to you, let me just check your address.");
    expect(result.segments[0]!.text).toBe("I'll get someone out to you.");
  });

  it("PRE-DEPLOY REGRESSION: never speaks the model narrating its own instructions", () => {
    const result = parseDelivery(
      "No problem, talk soon! The caller has said goodbye and ended the call. As instructed, I let them go with a warm closing line and did not ask any qualifying questions.",
    );
    expect(result.segments[0]!.text).toBe("No problem, talk soon!");
  });

  it.each([
    "Per my instructions, I can't quote a price.",
    "Following the guidelines, I'll keep this short.",
  ])("removes the instruction reference in %p", (input) => {
    expect(parseDelivery(`Got it. ${input} What's going on?`).segments[0]!.text).toBe(
      "Got it. What's going on?",
    );
  });

  it("speaks nothing at all when the whole reply is instruction narration, leaving speak() to use its safe fallback", () => {
    expect(parseDelivery("The caller has said goodbye and ended the call.").segments).toEqual([]);
  });

  it("leaves ordinary speech TO the caller untouched", () => {
    const input =
      "Thanks for calling! Can I get your name, and is this the best number to reach you?";
    expect(parseDelivery(input).segments[0]!.text).toBe(input);
  });

  it("never strips an utterance down to nothing on the narration rule alone", () => {
    const result = parseDelivery("Let me pull up your info real quick.");
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]!.text).toBe("Let me pull up your info real quick.");
  });
});

describe("silenceBuffer", () => {
  it("produces a mu-law-silence (0xFF) buffer sized for the requested duration at 8 bytes/ms", () => {
    const buffer = silenceBuffer(100);
    expect(buffer.length).toBe(800);
    expect(buffer.every((byte) => byte === 0xff)).toBe(true);
  });

  it("never produces a negative-length buffer for a zero or negative duration", () => {
    expect(silenceBuffer(0).length).toBe(0);
    expect(silenceBuffer(-50).length).toBe(0);
  });
});
