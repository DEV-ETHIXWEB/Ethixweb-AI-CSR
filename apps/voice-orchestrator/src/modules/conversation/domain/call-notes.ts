import { spokenPhoneDigits } from "./save-readiness";
import { collapseSpokenDigits } from "./service-area";
import { spelledWordsIn } from "./spelled-letters";
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
  /** Each distinct fixture the caller named, in the words they used, first mention first. */
  fixtures: string[];
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
  "water",
  "heater",
  "pipe",
  "pipes",
  "drain",
  "toilet",
  "sink",
  "faucet",
  "shower",
  "bathtub",
  "disposal",
  "sewer",
  "sewage",
  "valve",
  "sprinkler",
  "broken",
  "leaking",
  "leaked",
  "clogged",
  "overflowing",
  "flooding",
  "flooded",
  "burst",
  "dripping",
  "running",
  "backed",
  "kitchen",
  "bathroom",
  "basement",
  "upstairs",
  "downstairs",
  "outside",
  "inside",
  "garage",
  "something",
  "nothing",
  "problem",
  "issue",
  "help",
  "need",
  "there",
  "got",
  "want",
  "think",
  "because",
  "well",
  "thing",
  "stuff",
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
  const spellingAsked = turns.some(
    (turn) => turn.speaker === "agent" && /\bspell\b/i.test(turn.text),
  );
  const stated = statedName(callerTexts) ?? answeredName(turns);
  let spelled = spelledName(callerTexts, spellingAsked);
  if (spelled && spelled.length === 1 && stated) {
    spelled = splitSpelledByStated(spelled[0]!, stated);
  }
  return {
    spellingAsked,
    spelledName: spelled,
    statedName: stated,
    street: lastStreet(callerTexts),
    zip: lastZip(callerTexts),
    phone: spokenPhoneDigits(callerTexts),
    property: propertyType(callerTexts),
    timing: lastMatch(callerTexts, TIMING),
    fixtures: mentionedFixtures(callerTexts),
  };
}

/**
 * 2026-10-22 tester call: two problems in one call, a kitchen sink and a
 * toilet. Asked "both are booked, not one, right?", Grace answered that
 * "both of the toilets" would be looked at — two separate problems collapsed
 * into one, and the wrong one.
 *
 * Nothing in these notes had ever carried WHAT the call was about, so the
 * model was working from its own memory of a long call for the one fact the
 * lead is actually built on. Fixtures are listed verbatim, in the caller's
 * own words, first mention first, exactly like the street and the name:
 * cheap to read, impossible to merge by accident.
 *
 * Capped at three. A fourth is well past the point where a reply could
 * sensibly cover them, and the cap keeps the note short enough that the
 * model still reads the rest of it.
 */
const FIXTURE =
  /\b((?:kitchen|bathroom|master|guest|hall|upstairs|downstairs|basement|outside|outdoor|front|back|main|second|half)\s+)?(water heater|hot water tank|garbage disposal|disposal|toilet|sink|faucet|tap|shower|bathtub|tub|drain|pipe|sewer line|sewer|septic|sump pump|water line|gas line|main line|valve|spigot|hose bib|sprinkler|boiler|radiator|water softener|dishwasher|washing machine|washer)s?\b/gi;
const MAX_FIXTURES = 3;

function mentionedFixtures(callerTexts: readonly string[]): string[] {
  const found: string[] = [];
  for (const text of callerTexts) {
    for (const match of text.toLowerCase().matchAll(FIXTURE)) {
      const label = `${match[1] ?? ""}${match[2] ?? ""}`.replace(/\s+/g, " ").trim();
      if (!label) {
        continue;
      }
      // A bare "sink" after "kitchen sink" is the same fixture said again,
      // not a second one; a qualified "kitchen sink" after a bare "sink"
      // replaces it, since the caller has now said which one.
      const sameAs = found.findIndex(
        (earlier) => earlier.endsWith(label) || label.endsWith(earlier),
      );
      if (sameAs >= 0) {
        if (label.length > found[sameAs]!.length) {
          found[sameAs] = label;
        }
        continue;
      }
      found.push(label);
    }
  }
  return found.slice(0, MAX_FIXTURES);
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
  // Only ever listed when there are SEVERAL. One problem has never needed
  // restating -- the model has never been observed losing it -- and adding a
  // line to every call's every turn to fix a two-problem bug would be a
  // change to calls that are working.
  if (notes.fixtures.length > 1) {
    facts.push(
      `separate problems the caller has raised, all of them still open: ${notes.fixtures.join("; ")}` +
        ". Keep them separate, name each one as the caller did, and never let one stand for the other",
    );
  }
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

/** See spelled-letters.ts for the two spelling shapes this used to miss entirely. */
function spelledName(callerTexts: readonly string[], spellingAsked: boolean): string[] | null {
  for (let i = callerTexts.length - 1; i >= 0; i -= 1) {
    const words = spelledWordsIn(callerTexts[i] ?? "", spellingAsked);
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

/** Our own readback output: hyphenated digits beside a street word. Nothing a caller says looks like this. */
function readBackAnAddress(agentText: string): boolean {
  return (
    /\d-\d/.test(agentText) &&
    /\b(street|st|avenue|ave|road|rd|drive|dr|lane|ln|way|place|pl|court|ct|boulevard|blvd|circle|cir|terrace|ter|parkway|pkwy|highway|hwy)\b/i.test(
      agentText,
    )
  );
}

/** "my address is wrong", "that's not the street" — a dispute stated in words, at any point in the call. */
const ADDRESS_DISPUTED =
  /\b(wrong|not|isn'?t|aren'?t|different|incorrect|changed)\b[^.?!]{0,30}\b(address|street|house number|zip|zipcode)\b|\b(address|street|house number|zip|zipcode)\b[^.?!]{0,30}\b(is|was|isn'?t|not)\b[^.?!]{0,20}\b(wrong|right|correct|different|incorrect|changed|that)\b/i;

/** A bare "no" opening the reply to a readback. */
const OPENING_NEGATION = /^\s*(no|nope|nah|wrong|that'?s not|thats not|i said|i didn'?t say)\b/i;

/** "No hot water", "no rush", "no idea" — a negation that starts a fact, not a correction. */
const NEGATION_OF_SOMETHING_ELSE =
  /^\s*(no|nope|nah)\b[\s,]*(hot|cold|warm|water|heat|pressure|rush|hurry|problem|worries|one|body|idea|clue|leak|damage)\b/i;

const DISPUTE_MAX_WORDS = 10;

/**
 * 2026-10-22 tester call: "I kept saying that address is something else but
 * it didn't pay attention to it and kept on moving like you are all set."
 *
 * `addressReadbackNote` below already handles a correction, but only one
 * that arrives as a WHOLE parseable address (house number, name and street
 * type). Real corrections rarely do: "no, it's Maple, not Main", "I said
 * four five one two", "that's not my address". None of those parse, so no
 * note fired at all — and the call notes still carried the OLD street under
 * "never ask again for anything listed here", which is an instruction to do
 * exactly what the caller was complaining about.
 *
 * Two shapes count, both narrow on purpose. A dispute said in words
 * ("my address is wrong") at any point; or a short reply opening with a
 * plain negation immediately after Grace read an address back, where there
 * is nothing else it could be about. Negations that open an ordinary fact
 * ("no hot water") are excluded by name, since that is the false positive
 * that would cost a caller a re-asked address they had already given.
 */
export function addressDisputeNote(
  callerTexts: readonly string[],
  agentTexts: readonly string[],
): string | null {
  const latest = (callerTexts.at(-1) ?? "").trim();
  if (!latest) {
    return null;
  }
  const disputedInWords = ADDRESS_DISPUTED.test(latest);
  const negatedAReadback =
    OPENING_NEGATION.test(latest) &&
    !NEGATION_OF_SOMETHING_ELSE.test(latest) &&
    latest.split(/\s+/).length <= DISPUTE_MAX_WORDS &&
    readBackAnAddress(agentTexts.at(-1) ?? "");
  if (!disputedInWords && !negatedAReadback) {
    return null;
  }
  return (
    "[The caller is telling you the service address is wrong. The street in the call notes above " +
    "is NOT confirmed: ignore it. Your whole reply: ask for the one part they are correcting " +
    "(house number, or street name, or ZIP) in one short question. Do not move on, do not close " +
    "the call, and do not say they are all set until they have confirmed the corrected address.]"
  );
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
  const streetWords = street.split(" ");
  const spokenStreet =
    streetWords.length > 1 && /^\d{3,}$/.test(streetWords[0] ?? "")
      ? [
          streetWords[0]!
            .split("")
            .map((d) => (d === "0" ? "oh" : d))
            .join("-"),
          ...streetWords.slice(1),
        ].join(" ")
      : street;
  // Has the agent already read back a different address? If so, this is a
  // correction -- not a first-time readback.
  const everReadBackAddress = agentTexts.some(readBackAnAddress);
  if (everReadBackAddress) {
    return `[The caller corrected their address to "${spokenStreet}". Say ONLY "Got it, ${spokenStreet}." and continue to the next question. Do NOT read the full address again or ask them to confirm it a second time.]`;
  }
  const spokenZip = zip
    ?.split("")
    .map((d) => (d === "0" ? "oh" : d))
    .join("-");
  return zip
    ? `[The caller just gave their address. Your whole reply: read it back once, slowly ("So that's ${spokenStreet}, ZIP ${spokenZip}?") and ask if it's right. Ask nothing else.]`
    : `[The caller just gave their street address but no ZIP. Your whole reply: say the street back once ("${spokenStreet}") and ask for the ZIP. Ask nothing else.]`;
}
