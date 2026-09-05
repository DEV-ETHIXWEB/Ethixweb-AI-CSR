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
