/**
 * 2026-10-25, the client, on a test call: "the numbers of the address which
 * you are speaking are not clear to me ... you are basically mumbling these
 * digits ... say the address properly digit by digit individually". Grace
 * then said "5, 4, 0, 7, South Hood Court, Seattle, ZIP 9, 8, 1, 1, 8" and he
 * said "this time it was good ... wherever the digits are involved" use it.
 *
 * Replies write numbers three ways: "5-4-oh-7" (read fast, run together),
 * "5407" (read as "fifty-four oh seven") and "98118" (read as a quantity).
 * All three become single digits with a pause after each, the way he
 * approved. Applied to what the voice says only; the transcript keeps the
 * model's text.
 *
 * Left alone: money ("$150"), percentages, times ("3:30"), decimals, and
 * numbers of one or two digits ("2 hours", "24/7").
 */

/** "5-4-oh-7", "9-8-1-oh-3", "8-7-2-2-7-8-4-9-9-9": single digits (or "oh") joined by hyphens. */
const HYPHENATED_DIGITS = /\b(?:\d|oh)(?:\s*-\s*(?:\d|oh)\b)+/gi;
/** "872-278-4999", "(206) 895-6963", "895-6963": a phone number in groups. */
const GROUPED_PHONE = /(?:\(\d{3}\)\s*|\b\d{3}-)?\b\d{3}-\d{4}\b/g;
/** A whole number of three or more digits that is not money, a percentage, a time or a decimal. */
const LONG_NUMBER = /(?<![$\d.,:/])\b\d{3,}\b(?![\d%:/]|\.\d|,\d)/g;
/** "plus 8-7-2..." / "+1 872...": the country code is never said. */
const PLUS_BEFORE_DIGITS = /(?:\bplus\s+|\+)(?:1[\s-]+)?(?=\d)/gi;

/** Marks the end of a run turned into digits, so only those runs get a pause before the next word. */
const END = "\u0001";

function spaced(digits: string): string {
  return `${digits.split("").join(", ")}${END}`;
}

export function speakableNumbers(text: string): string {
  return text
    .replace(PLUS_BEFORE_DIGITS, "")
    .replace(GROUPED_PHONE, (phone) => spaced(phone.replace(/\D/g, "")))
    .replace(HYPHENATED_DIGITS, (run) =>
      spaced(run.toLowerCase().replace(/oh/g, "0").replace(/[\s-]/g, "")),
    )
    .replace(LONG_NUMBER, (number) => spaced(number))
    .replace(new RegExp(`${END}\\s+(?=[a-z0-9])`, "gi"), ", ")
    .replace(new RegExp(END, "g"), "");
}
