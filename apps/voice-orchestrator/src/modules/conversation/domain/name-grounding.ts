/**
 * Client feedback: a customer record was submitted without a clear name.
 * The model can invent a placeholder ("Unknown", "Caller") or save a name
 * the caller never said. This is the deterministic backstop: a first name
 * is only accepted if the caller actually said it (or spelled it out
 * letter by letter) somewhere in the call. Fuzzy by one edit so a normal
 * speech-to-text spelling difference ("Ana" vs "Anna") is not rejected.
 */

const PLACEHOLDER_NAMES = new Set([
  "unknown",
  "unnamed",
  "caller",
  "customer",
  "anonymous",
  "n/a",
  "na",
  "none",
  "tbd",
  "test",
]);

const normalize = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z\s]/g, " ");

export function editDistanceAtMostOne(a: string, b: string): boolean {
  if (a === b) {
    return true;
  }
  if (Math.abs(a.length - b.length) > 1) {
    return false;
  }
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) {
      return false;
    }
    if (a.length > b.length) {
      i += 1;
    } else if (b.length > a.length) {
      j += 1;
    } else {
      i += 1;
      j += 1;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/**
 * First letter plus the consonants, doubled letters collapsed: "prateek" and
 * "pratik" are both "prtk". Speech-to-text writes an unfamiliar name the way
 * it sounds, while the model writes the spelling it knows.
 */
function consonantSkeleton(word: string): string {
  const rest = word.slice(1).replace(/[aeiouy]/g, "");
  return (word[0] + rest).replace(/(.)\1+/g, "$1");
}

/**
 * Client feedback (Prateek, 2026-10-09): Grace collected a series of answers
 * and then started asking everything again from the first question. One
 * edit was the only tolerance here, so a caller heard as "Pratik" and saved
 * as "Prateek" (two edits) was refused with "the caller has not told you
 * their name yet", and the model took that as "you have nothing" and began
 * the intake over. Longer names now also match on two edits or on the same
 * consonant skeleton; short names keep the strict rule, where a loose match
 * would let common words through.
 */
function soundsLikeName(token: string, name: string): boolean {
  if (editDistanceAtMostOne(token, name)) {
    return true;
  }
  if (name.length < 4 || token.length < 4) {
    return false;
  }
  const skeleton = consonantSkeleton(name);
  if (skeleton.length >= 3 && skeleton === consonantSkeleton(token)) {
    return true;
  }
  return name.length >= 6 && editDistance(token, name) <= 2;
}

function editDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0]!;
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j]!;
      previous[j] = Math.min(
        above + 1,
        previous[j - 1]! + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[b.length]!;
}

/** True when `firstName` is a real name the caller said (or spelled) in one of `callerTexts`. */
export function isNameGroundedInCaller(firstName: string, callerTexts: readonly string[]): boolean {
  const name = normalize(firstName).replace(/\s+/g, "");
  if (name.length < 2 || PLACEHOLDER_NAMES.has(name)) {
    return false;
  }
  for (const text of callerTexts) {
    const cleaned = normalize(text);
    const tokens = cleaned.split(/\s+/).filter(Boolean);
    if (tokens.some((token) => soundsLikeName(token, name))) {
      return true;
    }
    // Spelled out letter by letter: "p r i y a".
    if (
      cleaned.replace(/\s+/g, "").includes(name) &&
      tokens.filter((t) => t.length === 1).length >= 2
    ) {
      return true;
    }
  }
  return false;
}

export const NAME_NOT_GIVEN_ERROR = {
  error: "name_not_given_by_caller",
  detail:
    "Not saved: the first name you passed is not one the caller said. If they did tell you their name, call this again using it exactly as they said it. If they never did, ask for their name in one short question. Everything else they already gave you (problem, address, phone) is still valid: do not ask for any of it again.",
} as const;
