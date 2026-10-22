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

/**
 * How a caller actually introduces themselves.
 *
 * 2026-10-22, Akash: "if CSR is asking name and on that time if customer is
 * telling the problem that CSR is not understanding... when a customer is
 * telling everything at the starting... soon after it is asking the same and
 * customer finds that it is just not understanding."
 *
 * Measured against nine realistic openings before touching anything: FIVE
 * lost the name completely, because the only forms recognised were "my name
 * is", "name is", "i go by" and a line-initial "this is". The most common
 * phrasings of all were missing — "I'm Tom Harris", "I am Robert Chen",
 * "hey it's Maria", "Tom Harris here" — so a caller who opened with
 * everything got asked for their name a turn later, which is exactly the
 * "it's just not understanding" complaint.
 *
 * Split in two because the name can come before or after the cue:
 * an introduction PHRASE then the name, or the name then "here"/"speaking".
 */
const NAME_STATEMENT =
  /\b(?:my name is|my name's|name is|i go by|my first name is|first name is|i'?m|i am|this is|it'?s|it is|you'?re speaking (?:with|to)|speaking with|call me|(?:update|change|correct|fix) (?:my |the )?name to)\s+(?:actually\s+|really\s+|just\s+|gonna be\s+|going to be\s+)?([a-z][a-z'-]+)(?:\s+([a-z][a-z'-]+))?/gi;

/** The trailing form: "Tom Harris here", "Dana speaking". */
const NAME_FIRST_STATEMENT =
  /(?:^|[.,!?]\s*)([a-z][a-z'-]+)(?:\s+([a-z][a-z'-]+))?\s+(?:here|speaking)\b/gi;
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
  const statedFound = statedNameAt(callerTexts);
  const stated = statedFound?.value ?? answeredName(turns);
  const spelledFound = spelledNameAt(callerTexts, spellingAsked);
  // The LATER of the two wins.
  //
  // 2026-10-22, client call: "when I said goodbye it still used my old name
  // instead of the updated one". A spelled name used to beat a stated one
  // unconditionally, so a caller who spelled a name early and changed it by
  // voice later was stuck with the first one for the rest of the call. Worse,
  // the output guard enforces this same choice, so it actively rewrote the
  // NEW name back to the old one when Grace said it.
  //
  // Order, not kind, decides it: "my name is Akash" then "a k a s h" is a
  // spelling of the name just given (spelled wins, as before), while
  // "a k a s h" then "update my name to Prateek" is a correction.
  let spelled =
    spelledFound && statedFound && statedFound.index > spelledFound.index
      ? null
      : (spelledFound?.words ?? null);
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
  /\b((?:kitchen|bathroom|master|guest|hall|upstairs|downstairs|basement|outside|outdoor|front|back|main|second|half)\s+)?(water heater|hot water tank|hot water|garbage disposal|disposal|toilet|sink|faucet|tap|shower|bathtub|tub|drain|pipe|sewer line|sewer|septic|sump pump|water line|gas line|main line|valve|spigot|hose bib|sprinkler|boiler|radiator|water softener|dishwasher|washing machine|washer)s?\b/gi;
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
  if (notes.spelledName) {
    const letters = notes.spelledName
      .map((word) => word.toUpperCase().split("").join("-"))
      .join(" ");
    facts.push(
      `name, spelled out by the caller: ${letters}. ` +
        `${splitForFields(notes.spelledName.map(capitalize).join(" "))}. ` +
        "Use exactly this name; never a different-sounding one",
    );
  } else if (notes.statedName) {
    // The LETTERS of what was actually heard, not just the word.
    //
    // 2026-10-22, second tester: "there are few instances where the csr
    // still guesses big names - i tried with mexican, caucasian and black
    // names". Asked to spell a name it only has by ear, the model supplies
    // the spelling of the nearest name it knows — "Siobhan" read back as
    // S-H-A-V-O-N-N-E. Handing it the exact letters removes the gap it was
    // filling with a guess, and does so for every name equally: a short
    // name from one region is no more or less at risk than a long one from
    // another, which a length rule could never say.
    facts.push(
      `name as heard, spelled ${spellOut(notes.statedName)}. ` +
        `${splitForFields(notes.statedName)}. ` +
        "Confirm it back as EXACTLY those letters, never a different or more familiar-sounding " +
        "spelling, and use whatever they correct it to",
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
    facts.push(`when they want help: "${neutralTiming(notes.timing)}"`);
  }
  // Kept OUT of `facts` on purpose. Everything in that list is covered by
  // "Never ask again for anything listed here", which is right for a name,
  // an address or a ZIP and badly wrong for a problem: it would stop Grace
  // asking whether the leak is running right now. Listed only when there are
  // SEVERAL, too -- one problem has never been seen getting lost, and adding
  // a line to every turn of every call to fix a two-problem bug would change
  // calls that are working.
  // 2026-10-22, Akash: a caller who says everything in their opening must
  // not be asked any of it again. This used to appear only when there were
  // SEVERAL problems — on the reasoning that one had never been seen getting
  // lost — but a single problem given in the opening breath was then the one
  // thing the notes did not carry, so it survived only in message history,
  // which compaction caps. One problem is now stated too; the "keep them
  // separate" rule still only applies when there is more than one.
  const problems =
    notes.fixtures.length > 1
      ? ` The caller has raised more than one separate problem: ${notes.fixtures.join("; ")}.` +
        " Keep them separate, name each one as the caller did, and never let one stand for the" +
        " other. Questions about each problem are still welcome; it is only the details above" +
        " that must not be asked for again."
      : notes.fixtures.length === 1
        ? ` What they called about: the ${notes.fixtures[0]}. Questions about it are still` +
          " welcome; it is only the details above that must not be asked for again."
        : "";
  if (facts.length === 0) {
    return problems ? `[Call notes.${problems}]` : null;
  }
  if (notes.spellingAsked) {
    facts.push("you already asked for a spelling once; do not ask for one again");
  }
  return (
    `[Call notes. Already said by the caller, from speech recognition: ${facts.join("; ")}. ` +
    "Never ask again for anything listed here. If one item looks wrong, confirm that one item once; " +
    `never restart the intake.${problems}]`
  );
}

/**
 * Names the first and last parts separately, so the model never has to split
 * a name itself.
 *
 * 2026-10-22, Akash: "when I say a full name to it, it sometimes just take my
 * first name and say it like twice, so it adds my first name as first name,
 * and even last name." The notes handed over one string ("Tom Harris") and
 * left the split to the model, which sometimes filled both tool fields with
 * the first token. A duplicate is already REFUSED at the save
 * (DUPLICATE_NAME_ERROR in name-grounding.ts), so the record stayed clean —
 * but the caller still heard the wrong name and the save had to round-trip.
 * This removes the guess instead of catching it afterwards.
 */
function splitForFields(fullName: string): string {
  const parts = fullName.split(/\s+/).filter(Boolean);
  const first = parts[0] ?? "";
  if (parts.length < 2) {
    return `that is a FIRST name only: first "${first}", and no last name — leave the last name empty, never repeat "${first}" as both`;
  }
  return `first name "${first}", last name "${parts.slice(1).join(" ")}" — pass them as those two separate fields, and never the same word as both`;
}

/** "Siobhan Okonkwo" -> "S-I-O-B-H-A-N, O-K-O-N-K-W-O". */
export function spellOut(name: string): string {
  return name
    .split(/\s+/)
    .map((word) =>
      word
        .replace(/[^a-z]/gi, "")
        .toUpperCase()
        .split("")
        .join("-"),
    )
    .filter((word) => word.length > 0)
    .join(", ");
}

/**
 * The client asked that Grace never say "today" or "tonight" (prompt v49,
 * and OWN_TODAY in output-guard.ts rewrites it in speech). These notes were
 * handing the word straight back as a fact to use -- found 2026-10-22 by
 * reading a whole simulated call's notes turn by turn, where "when they want
 * help: today" sat in every later turn's message. The caller's urgency is
 * what matters and survives; the banned word does not.
 */
function neutralTiming(timing: string): string {
  return /\b(today|tonight)\b/i.test(timing) ? "as soon as possible" : timing;
}

/**
 * The most recent spelled name and WHICH utterance it came from. The index
 * is what lets a later spoken correction win; see buildCallNotes.
 * See spelled-letters.ts for the two spelling shapes this used to miss.
 */
function spelledNameAt(
  callerTexts: readonly string[],
  spellingAsked: boolean,
): { words: string[]; index: number } | null {
  for (let i = callerTexts.length - 1; i >= 0; i -= 1) {
    const words = spelledWordsIn(callerTexts[i] ?? "", spellingAsked);
    if (words.length > 0) {
      return { words, index: i };
    }
  }
  return null;
}

/**
 * Prepositions and fillers that follow an introduction cue without being a
 * name. "this is Tom at 4512 maple street" captured "Tom At" as the full
 * name before this existed (2026-10-22), because "at" was in neither list.
 */
const NOT_A_NAME_EXTRA = new Set([
  "at",
  "in",
  "on",
  "near",
  "by",
  "over",
  "under",
  "to",
  "out",
  "up",
  "down",
  "back",
  "still",
  "now",
  "today",
  "tonight",
  "home",
  "house",
  "work",
  "office",
  "sorry",
  "hi",
  "hey",
  "hello",
  "speaking",
  "here",
  "trying",
  "wondering",
  "hoping",
  "worried",
  "concerned",
  "frustrated",
  "upset",
  "afraid",
  "street",
  "avenue",
  "road",
  "drive",
  "lane",
  "place",
  "court",
  "address",
  "number",
  "phone",
  "zip",
  "plumber",
  "technician",
  "appointment",
  "estimate",
  "quote",
  "service",
  // Found by hunting false positives after widening the patterns above
  // (2026-10-22): "it's been going for an hour" gave "Been", "i'm good
  // thanks" gave "Good Thanks", "i am done with it" gave "Done", and
  // "i'm here" gave "I'm" itself.
  "been",
  "being",
  "good",
  "great",
  "fine",
  "done",
  "ready",
  "busy",
  "free",
  "available",
  "able",
  "thanks",
  "thank",
  "please",
  "im",
  "ive",
  "ill",
  "id",
  "youre",
  "theyre",
  "thats",
  "theres",
  "whats",
  "dont",
  "cant",
  "wont",
  "didnt",
  "isnt",
  "arent",
  "me",
  "mine",
  "us",
  "we",
  "they",
  "them",
]);

/**
 * Whether a captured token can be a person's name at all.
 *
 * Checked against the FIXTURE pattern as well as the word lists, so the two
 * cannot drift: 2026-10-22 measurement found "dishwasher", "washer",
 * "boiler", "septic" and "sump pump" being saved as caller NAMES when the
 * caller answered the name question with their problem — every one of them
 * a word this module's own fixture detector already knew.
 *
 * An "-ing" word of six letters or more is rejected too, which covers
 * "calling", "having", "trying", "looking", "wondering" and the rest in one
 * rule rather than a list that keeps growing. It costs a real surname like
 * Harding, and the cost is one extra question; accepting "Trying" as a name
 * writes it to the customer record.
 */
function canBeName(token: string): boolean {
  // Apostrophes are stripped for the LOOKUP (so "i'm" tests as "im" and
  // "don't" as "dont"); a real apostrophe name like O'Brien is unaffected,
  // since nothing in the lists matches "obrien".
  const word = token.toLowerCase().replace(/[^a-z]/g, "");
  if (word.length < 2) {
    return false;
  }
  if (NOT_A_NAME.has(word) || NOT_A_NAME_EXTRA.has(word)) {
    return false;
  }
  if (word.length >= 6 && word.endsWith("ing")) {
    return false;
  }
  return !new RegExp(`^(?:${FIXTURE.source})$`, "i").test(word);
}

/** The most recent stated name and which utterance it came from. */
function statedNameAt(callerTexts: readonly string[]): { value: string; index: number } | null {
  let found: { value: string; index: number } | null = null;
  for (const [index, text] of callerTexts.entries()) {
    const lower = text.toLowerCase();
    for (const pattern of [NAME_STATEMENT, NAME_FIRST_STATEMENT]) {
      for (const match of lower.matchAll(pattern)) {
        const first = match[1] ?? "";
        if (!canBeName(first)) {
          continue;
        }
        const second = match[2] ?? "";
        const last = second && canBeName(second) ? ` ${capitalize(second)}` : "";
        found = { value: `${capitalize(first)}${last}`, index };
      }
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
    // The whole answer is checked against FIXTURE as well as each word,
    // because a fixture can be two words: "sump pump" passed a per-word
    // check and was saved as the caller's name (2026-10-22).
    const whole = words.join(" ");
    if (
      words.length >= 1 &&
      words.length <= 3 &&
      words.every((word) => canBeName(word)) &&
      !new RegExp(FIXTURE.source, "i").test(whole)
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
      // 2026-10-22, reading a whole simulated call's notes: "actually it's
      // 4512 maple street apartment b" parsed as "4512 maple street" and the
      // apartment was dropped -- from the notes, and so from the address the
      // model saves. A unit is not a decoration on an address; for half the
      // callers in a city it IS the address. Absorbed here, after the street
      // type and any direction, so the one place that reads addresses keeps
      // it for every caller of this module.
      end = absorbUnit(tokens, end);
      found = tokens.slice(house, end + 1).join(" ");
      break;
    }
  }
  return found;
}

const UNIT_WORDS = new Set([
  "apartment",
  "apt",
  "unit",
  "suite",
  "ste",
  "floor",
  "fl",
  "building",
  "bldg",
  "lot",
  "space",
  "room",
  "rm",
  "trailer",
]);

/** The "apartment b" / "unit 304" tail of a parsed street, or null when it has none. */
function unitIn(street: string): string | null {
  const tokens = street.split(" ");
  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (UNIT_WORDS.has(tokens[index] ?? "")) {
      return `${tokens[index]} ${tokens[index + 1]}`;
    }
  }
  return null;
}

/** Extends the end index over a trailing "apartment b" / "unit 304" / "suite 12a", or leaves it alone. */
function absorbUnit(tokens: readonly string[], end: number): number {
  const word = tokens[end + 1] ?? "";
  const value = tokens[end + 2] ?? "";
  if (!UNIT_WORDS.has(word)) {
    return end;
  }
  // A unit designator with nothing after it ("...street apartment") is the
  // caller mid-sentence, not a unit; keep the street as it stands.
  return /^[a-z0-9]{1,5}$/.test(value) ? end + 2 : end;
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
    // 2026-10-22, reading a whole simulated call's notes turn by turn: the
    // caller said "actually it's 4512 maple street apartment b" AFTER the
    // read-back, so this returned null (the house number had been said) and
    // the dispute note did not fire either (nothing about it is a negation).
    // The turn produced no instruction at all about the apartment — the one
    // thing the caller had just taken the trouble to add. It reaches the
    // saved address now via the notes, but a caller who adds a unit and
    // hears nothing back is the "it didn't pay attention" complaint again.
    const unit = unitIn(street);
    const unitSaid =
      unit !== null && agentTexts.some((text) => text.toLowerCase().includes(unit.toLowerCase()));
    if (unit !== null && !unitSaid) {
      return (
        `[The caller added a unit to their address: "${unit}". Say only "Got it, ${unit}." and ` +
        "carry on with what you were doing. Do not read the whole address back again, and " +
        "include the unit when you save the address.]"
      );
    }
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
  // 2026-10-22, client call: "the system confirmed my address more than
  // three times, which is unnecessary and makes the call repetitive ... it
  // should only reconfirm it once, at the end of the call."
  //
  // So taking the address no longer confirms it. A missing ZIP is still
  // asked for, because that is COLLECTING a fact rather than confirming one,
  // and the address is then read back exactly once, in the closing
  // confirmation alongside the name and the number (callbackNumberNote).
  if (zip) {
    return null;
  }
  return `[The caller just gave their street address but no ZIP. Your whole reply: ask for the ZIP. Do not read the address back, that happens once at the end. Ask nothing else.]`;
}
