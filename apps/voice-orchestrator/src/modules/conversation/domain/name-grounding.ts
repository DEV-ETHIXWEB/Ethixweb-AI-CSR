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

/** True when `firstName` is a real name the caller said (or spelled) in one of `callerTexts`. */
export function isNameGroundedInCaller(firstName: string, callerTexts: readonly string[]): boolean {
  const name = normalize(firstName).replace(/\s+/g, "");
  if (name.length < 2 || PLACEHOLDER_NAMES.has(name)) {
    return false;
  }
  for (const text of callerTexts) {
    const cleaned = normalize(text);
    const tokens = cleaned.split(/\s+/).filter(Boolean);
    if (tokens.some((token) => editDistanceAtMostOne(token, name))) {
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
    "The caller has not told you their name yet. Do not save anything. Ask for their name in one short question, then save it once they answer.",
} as const;
