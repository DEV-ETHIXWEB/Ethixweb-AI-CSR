import { spokenPhoneDigits } from "./save-readiness";
import { collapseSpokenDigits } from "./service-area";
import { STREET_SUFFIXES } from "./street-name";

/**
 * A running note of what the caller has already said, put in front of every
 * turn so the model works from the facts instead of its memory of a long call.
 *
 * Client feedback on the previous vendor's October calls, and our own test
 * calls on 2026-10-13: "home or business" asked three times after "home";
 * the full address given and then asked for again; a ZIP asked for, never
 * captured, and skipped; a name spelled out letter by letter ("s u m a i l a")
 * then said back as Milo, Myla and Adebailo; "Tony" turned into "Tonya". All
 * of those are the model losing or re-guessing something the caller already
 * gave. Prompt rules alone did not hold, so the facts are restated every turn.
 *
 * Deliberately conservative: only what can be read reliably from the
 * caller's own words goes in. When something is wrong (speech recognition
 * misheard it), the model is told to confirm that one item, never to start
 * the intake again. The latest mention wins, so a caller's correction
 * replaces the earlier value.
 */

export interface CallNotes {
  /** Grace has already asked the caller to spell something. */
  spellingAsked: boolean;
  spelledName: string[] | null;
  statedName: string | null;
  street: string | null;
  zip: string | null;
  phone: string | null;
  property: "home" | "business" | null;
  timing: string | null;
}

const NAME_STATEMENT =
  /(?:\b(?:my name is|my name's|name is|i go by|my first name is|first name is)|^(?:(?:hi|hey|hello|yeah|yes)[, ]+)?this is)\s+([a-z][a-z'-]+)(?:\s+([a-z][a-z'-]+))?/gi;
const NOT_A_NAME = new Set([
  "a",
  "an",
  "and",
  "the",
  "my",
  "last",
  "first",
  "it",
  "its",
  "it's",
  "i",
  "is",
  "calling",
  "about",
  "for",
  "from",
  "with",
  "here",
  "regarding",
  "so",
  "uh",
  "um",
  "yeah",
  "yes",
  "no",
  "not",
  "just",
  "going",
  "having",
  "gonna",
  "actually",
  "like",
  "your",
  "you",
  "plumbing",
  "all",
  "phase",
  "urgent",
  "important",
  "an",
  "emergency",
  "kind",
  "pretty",
  "really",
  "very",
  "bad",
  "serious",
  "weird",
  "crazy",
  "about",
  "regarding",
]);

const HOME_WORDS = /\b(home|house|residential|residence|apartment|condo|townhouse|my place)\b/i;
const BUSINESS_WORDS = /\b(business|commercial|office|restaurant|store|shop|building i manage)\b/i;
const TIMING =
  /\b(as soon as possible|asap|right away|right now|today|tonight|tomorrow( morning| afternoon| evening)?|this week|next week|anytime|any time|whenever|no rush|not urgent)\b/gi;

const NAME_QUESTION =
  /\b(your name|who am i speaking|what'?s your name|can i (get|have|grab) your name|and your name)\b/i;

/**
 * `turns`, when given, lets a bare answer to "What's your name?" count as the
 * name. QA 2026-10-13: "Ravi Mehta." on its own was not recognised, so
 * Grace kept asking for a name she already had.
 */
export function buildCallNotes(
  callerTexts: readonly string[],
  turns: ReadonlyArray<{ speaker: string; text: string }> = [],
): CallNotes {
  const stated = statedName(callerTexts) ?? answeredName(turns);
  let spelled = spelledName(callerTexts);
  if (spelled && spelled.length === 1 && stated) {
    spelled = splitSpelledByStated(spelled[0]!, stated);
  }
  return {
    spellingAsked: turns.some((turn) => turn.speaker === "agent" && /\bspell\b/i.test(turn.text)),
    spelledName: spelled,
    statedName: stated,
    street: lastStreet(callerTexts),
    zip: lastZip(callerTexts),
    phone: spokenPhoneDigits(callerTexts),
    property: propertyType(callerTexts),
    timing: lastMatch(callerTexts, TIMING),
  };
}

/**
 * When the caller spelled "k e n t j o h n" as one continuous run but
 * earlier stated "Kent John" (two words), try to split the single spelled
 * word into two. The stated name gives the word count; the split position
 * is found by trying every candidate and picking the one whose part
 * lengths best match the stated word lengths (within tolerance, because
 * STT can mishear "kent" as "kings").
 */
function splitSpelledByStated(singleSpelled: string, stated: string): string[] {
  const statedWords = stated.split(/\s+/).filter(Boolean);
  if (statedWords.length !== 2 || singleSpelled.length < 4) {
    return [singleSpelled];
  }
  const [firstLen, secondLen] = [statedWords[0]!.length, statedWords[1]!.length];
  let bestSplit = -1;
  let bestScore = Infinity;
  for (let i = 2; i <= singleSpelled.length - 2; i++) {
    const score = Math.abs(i - firstLen) + Math.abs(singleSpelled.length - i - secondLen);
    if (score < bestScore) {
      bestScore = score;
      bestSplit = i;
    }
  }
  if (bestSplit > 0 && bestScore <= 1) {
    return [singleSpelled.slice(0, bestSplit), singleSpelled.slice(bestSplit)];
  }
  return [singleSpelled];
}

/** The note text for the model, or null when the caller has not given anything yet. */
export function formatCallNotes(notes: CallNotes): string | null {
  const facts: string[] = [];
  if (notes.spelledName) {
    const spoken = notes.spelledName.map(capitalize).join(" ");
    const letters = notes.spelledName
      .map((word) => word.toUpperCase().split("").join("-"))
      .join(" ");
    facts.push(
      `name, spelled out by the caller: ${letters}, which is "${spoken}". Use exactly this name; never a different-sounding one`,
    );
  } else if (notes.statedName) {
    facts.push(
      `name as heard: "${notes.statedName}" (speech recognition can mishear names; if unsure, ask them to spell it once)`,
    );
  }
  if (notes.street) {
    facts.push(`street address as heard: "${notes.street}"`);
  }
  if (notes.zip) {
    facts.push(`ZIP: ${notes.zip.split("").join("-")}`);
  }
  if (notes.phone) {
    const p = notes.phone;
    facts.push(`callback number they gave: ${p.slice(0, 3)}-${p.slice(3, 6)}-${p.slice(6)}`);
  }
  if (notes.property) {
    facts.push(`property: ${notes.property}`);
  }
  if (notes.timing) {
    facts.push(`when they want help: "${notes.timing}"`);
  }
  if (facts.length === 0) {
    return null;
  }
  if (notes.spellingAsked) {
    facts.push("you already asked for a spelling once; do not ask for one again");
  }
  return (
    `[Call notes. Already said by the caller, from speech recognition: ${facts.join("; ")}. ` +
    "Never ask again for anything listed here. If one item looks wrong, confirm that one item once; " +
    "never restart the intake.]"
  );
}

function spelledName(callerTexts: readonly string[]): string[] | null {
  for (let i = callerTexts.length - 1; i >= 0; i -= 1) {
    const tokens = (callerTexts[i] ?? "")
      .toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean);
    const words: string[] = [];
    let run = "";
    for (const token of tokens) {
      if (token.length === 1) {
        run += token;
        continue;
      }
      if (run.length >= 3) {
        words.push(run);
      }
      run = "";
    }
    if (run.length >= 3) {
      words.push(run);
    }
    if (words.length > 0) {
      return words;
    }
  }
  return null;
}

function statedName(callerTexts: readonly string[]): string | null {
  let found: string | null = null;
  for (const text of callerTexts) {
    for (const match of text.toLowerCase().matchAll(NAME_STATEMENT)) {
      const first = match[1] ?? "";
      if (NOT_A_NAME.has(first)) {
        continue;
      }
      const last = match[2] && !NOT_A_NAME.has(match[2]) ? ` ${capitalize(match[2])}` : "";
      found = `${capitalize(first)}${last}`;
    }
  }
  return found;
}

function answeredName(turns: ReadonlyArray<{ speaker: string; text: string }>): string | null {
  let found: string | null = null;
  for (let i = 1; i < turns.length; i += 1) {
    const asked = turns[i - 1];
    const answer = turns[i];
    if (
      asked?.speaker !== "agent" ||
      answer?.speaker !== "caller" ||
      !NAME_QUESTION.test(asked.text)
    ) {
      continue;
    }
    const words = answer.text
      .toLowerCase()
      .replace(/^(it's|its|it is|i'm|im|yeah|yes|sure|oh|uh|um)[, ]+/g, "")
      .replace(/[^a-z\s'-]/g, " ")
      .split(/\s+/)
      .filter(Boolean);
    if (
      words.length >= 1 &&
      words.length <= 3 &&
      words.every((word) => !NOT_A_NAME.has(word) && word.length > 1)
    ) {
      found = words.map(capitalize).join(" ");
    }
  }
  return found;
}

function lastStreet(callerTexts: readonly string[]): string | null {
  for (let i = callerTexts.length - 1; i >= 0; i -= 1) {
    // The utterance on its own, then joined with the one before it, because
    // an address often arrives as "3810" and then "248th place south".
    const candidates = [
      callerTexts[i] ?? "",
      `${callerTexts[i - 1] ?? ""} ${callerTexts[i] ?? ""}`,
    ];
    for (const candidate of candidates) {
      const street = streetIn(candidate);
      if (street) {
        return street;
      }
    }
  }
  return null;
}

const DIRECTIONS = new Set([
  "n",
  "s",
  "e",
  "w",
  "ne",
  "nw",
  "se",
  "sw",
  "north",
  "south",
  "east",
  "west",
  "northeast",
  "northwest",
  "southeast",
  "southwest",
]);

function streetIn(text: string): string | null {
  const tokens = collapseSpokenDigits(text)
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  let found: string | null = null;
  for (let house = 0; house < tokens.length; house += 1) {
    if (!/^\d{1,6}$/.test(tokens[house] ?? "")) {
      continue;
    }
    for (let suffix = house + 1; suffix <= house + 5 && suffix < tokens.length; suffix += 1) {
      if (!STREET_SUFFIXES.has(tokens[suffix] ?? "")) {
        continue;
      }
      if (suffix === house + 1 && !DIRECTIONS.has(tokens[house + 1] ?? "")) {
        // "1912 avenue" has no street name; keep looking.
        continue;
      }
      let end = suffix;
      while (end + 1 < tokens.length && DIRECTIONS.has(tokens[end + 1] ?? "")) {
        end += 1;
      }
      found = tokens.slice(house, end + 1).join(" ");
      break;
    }
  }
  return found;
}

function lastZip(callerTexts: readonly string[]): string | null {
  for (let i = callerTexts.length - 1; i >= 0; i -= 1) {
    const text = collapseSpokenDigits(callerTexts[i] ?? "");
    const saidZip = /\b(zip|postal)\b/.test(text);
    const matches = [
      ...text.matchAll(
        /(?<!\d)(\d{5})(?!\d)(?!\s+[a-z]+\s+(st|street|ave|avenue|rd|road|way|blvd|dr|drive|ln|lane|pl|place|ct|court)\b)/g,
      ),
    ];
    for (let j = matches.length - 1; j >= 0; j -= 1) {
      const zip = matches[j]?.[1];
      if (zip && (saidZip || /^9[89]/.test(zip))) {
        return zip;
      }
    }
  }
  return null;
}

function propertyType(callerTexts: readonly string[]): "home" | "business" | null {
  for (let i = callerTexts.length - 1; i >= 0; i -= 1) {
    const text = callerTexts[i] ?? "";
    const home = HOME_WORDS.test(text);
    const business = BUSINESS_WORDS.test(text);
    if (home !== business) {
      return home ? "home" : "business";
    }
  }
  return null;
}

function lastMatch(callerTexts: readonly string[], pattern: RegExp): string | null {
  for (let i = callerTexts.length - 1; i >= 0; i -= 1) {
    const matches = [...(callerTexts[i] ?? "").toLowerCase().matchAll(pattern)];
    const last = matches.at(-1)?.[0];
    if (last) {
      return last;
    }
  }
  return null;
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * QA 2026-10-13: a caller who volunteered the address while Grace was waiting
 * on a different question ("is it leaking right now?") was ignored, and she
 * asked her question again; the address was never read back and the request
 * was never saved. When the caller's latest words carry a street address that
 * has not been read back yet, the next reply reads it back (asking for the ZIP
 * if there is none) and nothing else.
 */
export function addressReadbackNote(
  callerTexts: readonly string[],
  agentTexts: readonly string[],
): string | null {
  const latest = callerTexts.at(-1) ?? "";
  const street = lastStreet([latest]) ?? lastStreet(callerTexts.slice(-2));
  if (!street) {
    return null;
  }
  const houseNumber = street.split(" ")[0] ?? "";
  const alreadyReadBack = agentTexts.some((text) =>
    collapseSpokenDigits(text).replace(/[\s-]/g, "").includes(houseNumber),
  );
  if (alreadyReadBack) {
    return null;
  }
  const zip = lastZip(callerTexts);
  return zip
    ? `[The caller just gave their address. Your whole reply: read it back once, slowly ("So that's ${street}, ZIP ${zip.split("").join("-")}?") and ask if it's right. Ask nothing else.]`
    : `[The caller just gave their street address but no ZIP. Your whole reply: say the street back once ("${street}") and ask for the ZIP. Ask nothing else.]`;
}
