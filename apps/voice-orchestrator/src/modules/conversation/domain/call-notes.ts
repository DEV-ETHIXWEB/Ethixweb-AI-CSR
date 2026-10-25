import { spokenPhoneDigits } from "./save-readiness";
import { collapseSpokenDigits, withoutFillerAfterNumbers } from "./service-area";
import { reducePhoneticSpelling, spelledWordsIn } from "./spelled-letters";
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
  /\b(?<!\b(?:last|family|second|street|state|city|road|business|company|restaurant|building|property|shop|store) )(?:my name is|my name's|name is|i go by|my first name is|first name is|i'?m|i am|this is|it'?s|it is|you'?re speaking (?:with|to)|speaking with|call me|(?:update|change|correct|fix) (?:my |the )?name to)\s+(?:actually\s+|really\s+|just\s+|gonna be\s+|going to be\s+)?([a-z][a-z'-]+)(?:\s+([a-z][a-z'-]+))?/gi;

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
  rawCallerTexts: readonly string[],
  rawTurns: ReadonlyArray<{ speaker: string; text: string }> = [],
): CallNotes {
  const callerTexts = rawCallerTexts.map(withoutAccents);
  const turns = rawTurns.map((turn) => ({ ...turn, text: withoutAccents(turn.text) }));
  const spellingAsked = turns.some(
    (turn) => turn.speaker === "agent" && /\bspell\b/i.test(turn.text),
  );
  const utterances = nameUtterances(callerTexts, turns);
  const nameTexts = utterances.map((utterance) => utterance.text);
  const statedFound = statedNameAt(nameTexts);
  let stated = statedFound?.value ?? answeredName(turns);
  // 2026-10-23 client call: "you are an AI", heard as "u r n a i u r n",
  // became the name "Urn Aiurn". Letters only count as a spelled NAME when
  // there is a reason to read them as one: Grace asked for a spelling, the
  // caller said they are spelling or giving their name, or the letters match
  // the name they gave.
  const spellings = spelledNamesIn(nameTexts, spellingAsked).filter(
    (spelling) =>
      spellingAsked ||
      utterances[spelling.index]?.answersNameQuestion === true ||
      SPELLING_CONTEXT.test(nameTexts[spelling.index] ?? "") ||
      isOnlyASpelling(nameTexts[spelling.index] ?? "") ||
      (statedFound !== null &&
        spelling.words.some((word) =>
          [
            statedFound.value.toLowerCase().replace(/\s+/g, ""),
            ...statedFound.value.toLowerCase().split(/\s+/),
          ].some((stated) => likeness(word, stated) >= SAME_NAME_LIKENESS),
        )),
  );
  let spelledFound = spellings.at(-1) ?? null;
  // A three-letter spelled run with nothing to corroborate it is far more
  // often speech-recognition debris than a name. Found 2026-10-22 in a real
  // transcript: Grace said "Your name is S-S-K, spelled as you said it."
  // Three letters is kept legitimate when there is a reason to trust it:
  // Grace asked for a spelling, or the caller also SAID a name that it
  // matches ("my name is Bob, B O B").
  if (
    spelledFound &&
    spelledFound.words.length === 1 &&
    (spelledFound.words[0] ?? "").length === 3 &&
    !spellingAsked &&
    !statedFound
  ) {
    spelledFound = null;
  }
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
    if (spelled.length === 1) {
      spelled = spelledIntoItsSlot(spelled[0]!, stated, spellings, statedFound?.index ?? -1);
    }
  }
  // Grace asked for the LAST name, so what came back is the last name. Without
  // this a spelled reply replaced the first name, and a spoken one was lost.
  const answer = nameTexts.at(-1) ?? "";
  if (stated && lastNameJustAsked(turns)) {
    const first = stated.split(/\s+/)[0]!;
    if (spelled?.length === 1 && spelledFound?.index === nameTexts.length - 1) {
      const earlier = spellings
        .slice(0, -1)
        .filter((spelling) => spelling.words.length === 1)
        .at(-1)?.words[0];
      spelled = [earlier ?? first.toLowerCase(), spelled[0]!];
    } else if (!spelledFound || spelledFound.index !== nameTexts.length - 1) {
      const words = wordsOf(answer).filter((word) => !NAME_ANSWER_FILLER.has(word));
      if (words.length === 1 && canBeName(words[0]!)) {
        stated = `${first} ${capitalize(words[0]!)}`;
      }
    }
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
/**
 * 2026-10-24, Yash's test call: "my name is alejandro gonzález" went into the
 * notes as "Alejandro Gonz", and Grace spelled it "G-O-N-Z". Every name rule
 * here reads a-z; an accented letter ended the word. "á" is read as "a".
 */
export function withoutAccents(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function spellOut(name: string): string {
  return withoutAccents(name)
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
 * Every spelled name and WHICH utterance it came from, oldest first. The
 * index is what lets a later spoken correction win; see buildCallNotes.
 * See spelled-letters.ts for the two spelling shapes this used to miss.
 */
function spelledNamesIn(
  callerTexts: readonly string[],
  spellingAsked: boolean,
): Array<{ words: string[]; index: number }> {
  const found: Array<{ words: string[]; index: number }> = [];
  for (const [index, text] of callerTexts.entries()) {
    // "r e n a t a ... r e n a t a, d u b o i s": the same word spelled
    // twice is one word, not a first name and a middle name.
    const words = spelledWordsIn(text, spellingAsked)
      .map((word) => {
        const half = word.length / 2;
        return half >= 3 && word.slice(0, half) === word.slice(half) ? word.slice(0, half) : word;
      })
      .filter((word, at, all) => at === 0 || word !== all[at - 1]);
    if (words.length > 0) {
      found.push({ words, index });
    }
  }
  return found;
}

/**
 * 2026-10-23, client call: "my name is Siobhan" / "Okonkwo", then each name
 * spelled separately when asked. Only the LATEST spelling was kept, and as
 * the whole name, so the customer was saved as first name "Okonkwo" with no
 * last name, and Grace closed with "You're all set, Okonkwo".
 *
 * A single spelled word goes in the slot of the stated word it resembles,
 * and the other slot keeps an earlier spelling of it, or the stated word.
 * A spelling that resembles neither is left as it was, since then there is
 * nothing to say which name it is.
 */
function spelledIntoItsSlot(
  word: string,
  stated: string,
  spellings: ReadonlyArray<{ words: string[]; index: number }>,
  statedIndex: number,
): string[] {
  const statedWords = stated.toLowerCase().split(/\s+/).filter(Boolean);
  if (statedWords.length !== 2) {
    return [word];
  }
  const slotOf = (candidate: string): 0 | 1 | null => {
    const toFirst = likeness(candidate, statedWords[0]!);
    const toLast = likeness(candidate, statedWords[1]!);
    if (Math.max(toFirst, toLast) < SAME_NAME_LIKENESS) {
      return null;
    }
    return toFirst >= toLast ? 0 : 1;
  };
  const slot = slotOf(word);
  if (slot === null) {
    return [word];
  }
  const other = slot === 0 ? 1 : 0;
  const earlier = spellings
    .slice(0, -1)
    .filter((spelling) => spelling.index >= statedIndex && spelling.words.length === 1)
    .map((spelling) => spelling.words[0]!)
    .reverse()
    .find((candidate) => slotOf(candidate) === other);
  const result = ["", ""];
  result[slot] = word;
  result[other] = earlier ?? statedWords[other]!;
  return result;
}

/**
 * The whole utterance is letters ("a l e x a n d e r", "s for sam, i for
 * india"): nobody says that by accident. The "u r n a i u r n damas" kind of
 * debris always comes with ordinary words around it.
 */
function isOnlyASpelling(text: string): boolean {
  const tokens = reducePhoneticSpelling(text)
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  // "it's y a s h", "no it's j o s h": a few words of lead-in, then letters.
  while (tokens.length > 0 && SPELLING_LEAD_IN.has(tokens[0]!)) {
    tokens.shift();
  }
  return (
    tokens.length >= 3 &&
    tokens.every((token) => token.length === 1 || token === "double" || token === "triple")
  );
}

const SPELLING_LEAD_IN = new Set([
  "its",
  "it",
  "is",
  "thats",
  "that",
  "no",
  "yes",
  "yeah",
  "okay",
  "ok",
  "so",
  "um",
  "uh",
  "well",
  "actually",
]);

/** The caller saying that what follows is their name, or a spelling. */
const SPELLING_CONTEXT = /\b(spell|spelled|spelling|name|names)\b/i;

/** How alike two words are, from 0 to 1: one minus the edit distance over the longer length. */
const SAME_NAME_LIKENESS = 0.5;
function likeness(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, k) => k);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0]!;
    previous[0] = i;
    for (let k = 1; k <= b.length; k += 1) {
      const above = previous[k]!;
      previous[k] = Math.min(
        above + 1,
        previous[k - 1]! + 1,
        diagonal + (a[i - 1] === b[k - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return 1 - previous[b.length]! / Math.max(a.length, b.length, 1);
}

/**
 * The caller's words as they were said, for reading a NAME out of them.
 *
 * 2026-10-23, client calls: a name said with a pause in it arrives as two
 * utterances, "yes my name is trevor" then "lindquist", and the last name was
 * dropped because each was read on its own. Back-to-back caller utterances,
 * with nothing from Grace between them, are one thing said, so they are read
 * as one. Only possible when the transcript is at hand and matches.
 *
 * A spelling cut in half is joined too: "the last name is lindquist l i n d",
 * then, after Grace talked over the pause, "q v i s t". Grace said "Your name
 * is Qvist" and asked for the address. Only joined when the letters so far
 * are the START of a word just said, so they cannot be a finished spelling,
 * and the next utterance is nothing but letters.
 */
function nameUtterances(
  callerTexts: readonly string[],
  turns: ReadonlyArray<{ speaker: string; text: string }>,
): Array<{ text: string; answersNameQuestion: boolean }> {
  const fromTurns = turns.filter((turn) => turn.speaker === "caller").map((turn) => turn.text);
  const matches =
    fromTurns.length === callerTexts.length &&
    fromTurns.every((text, index) => text === callerTexts[index]);
  const said: Array<{ text: string; answersNameQuestion: boolean }> = [];
  if (matches) {
    let previousWasCaller = false;
    let lastAgent = "";
    for (const turn of turns) {
      if (turn.speaker === "caller" && previousWasCaller && said.length > 0) {
        said[said.length - 1]!.text = `${said.at(-1)!.text} ${turn.text}`;
      } else if (turn.speaker === "caller") {
        said.push({
          text: turn.text,
          answersNameQuestion: NAME_QUESTION.test(lastAgent) || /\bspell\b/i.test(lastAgent),
        });
      } else {
        lastAgent = turn.text.replace(/[’‘]/g, "'");
      }
      // 2026-10-23 client call: "okay my name" / Grace: "Yes, I'm here" /
      // "is barry allen". Grace was talked over two words in, so the caller
      // never stopped: a reply cut off before its end does not separate what
      // they said on either side of it. A finished reply ends in punctuation.
      previousWasCaller =
        turn.speaker === "caller" || (previousWasCaller && !/[.!?]["')\]]*\s*$/.test(turn.text));
    }
  } else {
    said.push(...callerTexts.map((text) => ({ text, answersNameQuestion: false })));
  }
  const joined: Array<{ text: string; answersNameQuestion: boolean }> = [];
  for (const piece of said) {
    const before = joined.at(-1);
    if (before !== undefined && endsMidSpelling(before.text) && isOnlyLetters(piece.text)) {
      before.text = `${before.text} ${piece.text}`;
    } else {
      joined.push({ ...piece });
    }
  }
  return joined;
}

const LAST_NAME_QUESTION = /\b(last name|surname|family name)\b/i;
const NAME_ANSWER_FILLER = new Set([
  "it",
  "its",
  "it's",
  "is",
  "yes",
  "yeah",
  "sure",
  "oh",
  "uh",
  "um",
  "my",
  "last",
  "name",
  "s",
]);

/** Grace's latest words asked for the last name, and the caller has answered since. */
function lastNameJustAsked(turns: ReadonlyArray<{ speaker: string; text: string }>): boolean {
  let lastAgent = turns.length - 1;
  while (lastAgent >= 0 && turns[lastAgent]!.speaker !== "agent") {
    lastAgent -= 1;
  }
  return (
    lastAgent >= 0 &&
    lastAgent < turns.length - 1 &&
    LAST_NAME_QUESTION.test(turns[lastAgent]!.text)
  );
}

function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function isOnlyLetters(text: string): boolean {
  const words = wordsOf(text);
  return words.length > 0 && words.every((word) => word.length === 1);
}

/** "lindquist l i n d": the trailing letters begin a word said just before, and stop short of it. */
function endsMidSpelling(text: string): boolean {
  const words = wordsOf(text);
  let letters = "";
  let k = words.length - 1;
  while (k >= 0 && words[k]!.length === 1) {
    letters = words[k] + letters;
    k -= 1;
  }
  if (letters.length < 2) {
    return false;
  }
  return words
    .slice(0, k + 1)
    .some((word) => word.length > letters.length && word.startsWith(letters));
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
  // Conversational filler taken as a NAME on real calls, found 2026-10-22 by
  // running the last 100 calls' transcripts back through this parser:
  // "okay" became the name Okay, "yeah sure" became Sure, and "go ahead"
  // became Go Ahead. One transcript has Grace saying: 'your name is spelled
  // "O-K-A-Y, T-H-A-T apostrophe S, R-I-G-H-T"'.
  "okay",
  "ok",
  "kay",
  "alright",
  "sure",
  "right",
  "correct",
  "yep",
  "yup",
  "nope",
  "nah",
  "go",
  "ahead",
  "hold",
  "wait",
  "hang",
  "there",
  "definitely",
  "absolutely",
  "exactly",
  "perfect",
  "cool",
  "awesome",
  "maybe",
  "probably",
  "anyway",
  "nothing",
  "anything",
  "everything",
  "someone",
  "somebody",
  "anyone",
  // 2026-10-23, an emergency call: "i'm actually also smelling something
  // burning" gave the name "Also". With a name on file Grace never asked for
  // the real one, and saved the emergency lead under "Also". An earlier call
  // had "hello, it's yours" saved as "Yours". Adverbs and possessives that
  // follow "i'm" or "it's" in ordinary speech.
  "also",
  "too",
  "even",
  "only",
  "yours",
  "his",
  "hers",
  "ours",
  "theirs",
  "kinda",
  "sorta",
  "literally",
  "basically",
  "honestly",
  "currently",
  "already",
  "always",
  "never",
  "little",
  "bit",
  "quite",
  "super",
  "totally",
  "completely",
  "glad",
  "happy",
  // From the same 10-day sweep: "it's where is it" overwrote "Paul Allen"
  // with "Where", "it's spelled" gave "Spelled", "this is seattle" gave
  // "Seattle".
  "where",
  "what",
  "when",
  "who",
  "why",
  "how",
  "which",
  "whatever",
  "spelled",
  "spell",
  "spelling",
  "seattle",
  "washington",
  "tacoma",
  "bellevue",
  "redmond",
  "kirkland",
  "renton",
  "everett",
  "bothell",
  "lynnwood",
  "state",
  "city",
  "wrong",
  // QA 2026-10-23 (v38-02): "it's actively leaking" gave the name Actively,
  // which then kept Grace from ever asking for the real one. Adverbs that
  // describe a leak; none of them is anyone's name.
  "actively",
  "constantly",
  "continuously",
  "slowly",
  "quickly",
  "suddenly",
  "badly",
  "barely",
  "mostly",
  "partly",
  "slightly",
  "heavily",
  "randomly",
  "rapidly",
  "steadily",
  "nearly",
  "occasionally",
  "frequently",
  "usually",
  "finally",
  "recently",
  // The same replay of every prefix of every call: "if i'm unhappy do you
  // care", "it's somewhat wet", "as long as it's upfront", and a tester
  // playing the receptionist ("hi this is grace at all phase plumbing").
  "unhappy",
  "somewhat",
  "upfront",
  "grace",
  "nervous",
  "scared",
  "annoyed",
  "angry",
  "mad",
  "sad",
  "aware",
  "certain",
  "are",
  "were",
  "be",
  "has",
  "have",
  "had",
  "can",
  "could",
  "will",
  "would",
  "should",
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
  // 2026-10-23 client calls: "it's four twelve unit four twelve" gave the
  // name Four Twelve, and "i am unable to understand" gave Unable, which was
  // saved on the lead. A spoken number is never a first name, and these
  // endings are adjectives far more often than names (Mable and Clive are
  // shorter than the cut-off, so they still pass).
  if (SPOKEN_NUMBERS.has(word)) {
    return false;
  }
  if (word.length >= 6 && /(?:able|ible|ful|less|ous)$/.test(word)) {
    return false;
  }
  return !new RegExp(`^(?:${FIXTURE.source})$`, "i").test(word);
}

const SPOKEN_NUMBERS = new Set([
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
  "hundred",
  "thousand",
  "double",
  "triple",
]);

/**
 * Words a name is almost never followed by. "i am unable TO understand", "i'm
 * sorry ABOUT that": after a loose cue (i'm, i am, it's, this is) the word in
 * the name slot is describing something, not naming anyone, when one of these
 * comes straight after it. Not "and", "at", "from" or "with": "i'm Tom and I
 * have a leak", "this is Tom at 4512 Maple", "Tom from the restaurant" are
 * how people actually introduce themselves.
 */
// "than": 2026-10-24, Prateek's test call: "it's better than i do" became
// the name "Better Than", and Grace asked him to spell it mid-address.
const NOT_AFTER_A_NAME = /^\s+(?:to|about|that|of|if|because|so|the|a|an|than)\b/i;
const LOOSE_CUE = /^(?:i'?m|i am|it'?s|it is|this is)\b/i;

/** "the last name is Lindquist", "surname's Okonkwo". */
const LAST_NAME_STATEMENT =
  /\b(?:last name|surname|family name|second name)(?:\s+is|'s|\s+would be|\s+will be)?\s+([a-z][a-z'-]+)/gi;

/**
 * The most recent stated name and which utterance it came from.
 *
 * 2026-10-23, client call: "it's trevor and the last name is lindquist" made
 * LINDQUIST the first name, since "name is X" was read as a whole name
 * wherever it appeared. A last-name statement now sets the last name only,
 * and a first name restated on its own keeps the last name it already had.
 */
function statedNameAt(callerTexts: readonly string[]): { value: string; index: number } | null {
  type Said = { index: number; at: number; first?: string; second?: string; last?: string };
  const said: Said[] = [];
  for (const [index, text] of callerTexts.entries()) {
    // "my name is todd todd allen": a stutter, not a first and last name
    // (2026-10-23; the save was then refused as "first and last name are
    // identical" and the retry dropped Allen).
    const lower = text.toLowerCase().replace(/\b([a-z']+)(?:[\s,.]+\1\b)+/g, "$1");
    for (const pattern of [NAME_STATEMENT, NAME_FIRST_STATEMENT]) {
      for (const match of lower.matchAll(pattern)) {
        const at = match.index ?? 0;
        const end = at + match[0].length;
        const second = match[2] ?? "";
        const firstEnd = second ? at + lower.slice(at, end - second.length).trimEnd().length : end;
        if (LOOSE_CUE.test(match[0]) && NOT_AFTER_A_NAME.test(lower.slice(firstEnd))) {
          continue;
        }
        // 2026-10-23, live call: correcting the street read back to him, the
        // caller said "yes it's it's pontler roy way", and Grace began calling
        // him Pontler. After a loose cue, a street type within the next two
        // words makes it a street.
        if (
          LOOSE_CUE.test(match[0]) &&
          (lower.slice(at + match[0].indexOf(match[1] ?? "")).match(/[a-z0-9']+/g) ?? [])
            .slice(1, 3)
            .some((word) => STREET_SUFFIXES.has(word))
        ) {
          continue;
        }
        // "it's steadily dripping": an -ly word straight before a verb is
        // describing the problem. Emily, Kelly and Kimberly are names; they
        // are only refused here, in front of an -ing or -ed word.
        if (
          LOOSE_CUE.test(match[0]) &&
          /ly$/.test(match[1] ?? "") &&
          /^\s+[a-z]+(?:ing|ed)\b/.test(lower.slice(firstEnd))
        ) {
          continue;
        }
        said.push({ index, at, first: match[1] ?? "", second });
      }
    }
    for (const match of lower.matchAll(LAST_NAME_STATEMENT)) {
      said.push({ index, at: match.index ?? 0, last: match[1] ?? "" });
    }
  }
  said.sort((a, b) => a.index - b.index || a.at - b.at);
  let first: string | null = null;
  let last: string | null = null;
  let index = -1;
  // 2026-10-24, Prateek's test call: "my name is marcus william", then a
  // garbled spelling heard as "it's martha ...", then "my name is marcus".
  // Martha cleared the surname, and the notes told Grace "a first name only,
  // no last name". A first name said again gets back the surname it was
  // given with.
  const surnameOf = new Map<string, string>();
  for (const item of said) {
    if (item.last !== undefined) {
      if (canBeName(item.last)) {
        last = capitalize(item.last);
        index = item.index;
      }
      continue;
    }
    const name = item.first ?? "";
    if (!canBeName(name)) {
      continue;
    }
    const second = item.second && canBeName(item.second) ? capitalize(item.second) : null;
    if (second) {
      last = second;
      surnameOf.set(name.toLowerCase(), second);
    } else if (first?.toLowerCase() !== name.toLowerCase()) {
      last = surnameOf.get(name.toLowerCase()) ?? null;
    }
    first = capitalize(name);
    index = item.index;
  }
  return first ? { value: last ? `${first} ${last}` : first, index } : null;
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
      .replace(/\b([a-z']+)(?:[\s,.]+\1\b)+/g, "$1")
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
  let correction: { to: string; from: string } | null = null;
  for (let i = callerTexts.length - 1; i >= 0; i -= 1) {
    correction ??= houseNumberCorrection(callerTexts[i] ?? "");
    // The utterance on its own, then joined with the one before it, because
    // an address often arrives as "3810" and then "248th place south".
    const candidates = [
      callerTexts[i] ?? "",
      `${callerTexts[i - 1] ?? ""} ${callerTexts[i] ?? ""}`,
    ];
    for (const candidate of candidates) {
      const street = streetIn(candidate);
      if (street) {
        const [house, ...rest] = street.split(" ");
        const corrected =
          correction && house === correction.from ? [correction.to, ...rest].join(" ") : street;
        return withLaterUnit(corrected, callerTexts.slice(i + 1));
      }
    }
  }
  return null;
}

/**
 * 2026-10-23, test call through the live pipeline: Grace read back "1-2-1-5
 * North Ninety Second Street", the caller said "no sorry it's twelve fifty
 * not twelve fifteen", and the notes kept 1215, so Grace asked "what's the
 * correct house number, then?", the number she had just been given. "X not
 * Y", where Y is the house number on file, replaces it. Only this order:
 * "not twelve fifteen, twelve fifty" runs the two numbers together.
 */
const HOUSE_NUMBER_CORRECTION = /\b(\d{1,6})\s*,?\s+not\s+(\d{1,6})\b/;

function houseNumberCorrection(text: string): { to: string; from: string } | null {
  const match = collapseSpokenDigits(text.toLowerCase()).match(HOUSE_NUMBER_CORRECTION);
  return match?.[1] && match[2] && match[1] !== match[2] ? { to: match[1], from: match[2] } : null;
}

/**
 * 2026-10-23 client call: "...westlake avenue unit four", then, a turn later,
 * "it's four twelve unit four twelve". The street came from the first
 * utterance, so the unit stayed "4" and the lead was saved as unit 4 of a
 * building where the caller lives in 412. A unit said after the street is
 * the newer word on it.
 */
function withLaterUnit(street: string, laterTexts: readonly string[]): string {
  for (let i = laterTexts.length - 1; i >= 0; i -= 1) {
    const tokens = collapseSpokenDigits(laterTexts[i] ?? "")
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter(Boolean);
    for (let at = tokens.length - 2; at >= 0; at -= 1) {
      const value = tokens[at + 1] ?? "";
      if (UNIT_WORDS.has(tokens[at] ?? "") && /^[a-z0-9]{1,5}$/.test(value) && /\d/.test(value)) {
        const current = unitIn(street);
        const unit = `${tokens[at]} ${value}`;
        return current ? street.replace(current, unit) : `${street} ${unit}`;
      }
    }
  }
  return street;
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

const NOT_A_STREET_NAME = new Set(["the", "a", "an", "is", "my", "name", "and", "it", "its"]);

function streetIn(text: string): string | null {
  // 2026-10-23 client call: "one seven four eight and it's / westlake avenue"
  // was saved as the street "1748 and it s westlake avenue". Apostrophes close
  // up ("it's" is one word), and words that only join the caller's sentence
  // together are not part of a street name.
  const tokens = withoutFillerAfterNumbers(collapseSpokenDigits(text.replace(/[’']/g, "")))
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
      // 2026-10-23, Akash's test call: "seattle washington nine eight zero
      // two one" then "well the street name is sixty street" became the
      // street "98021 the street": the ZIP as a house number, "the" as the
      // name. Grace read it back as an address and saved it.
      if (tokens.slice(house + 1, suffix).every((word) => NOT_A_STREET_NAME.has(word))) {
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
  // The new house number is already in the notes (see lastStreet); asking
  // for it again is asking for what the caller just said.
  const correction = houseNumberCorrection(latest);
  const before = lastStreet(callerTexts.slice(0, -1));
  if (correction && before?.split(" ")[0] === correction.from) {
    return (
      `[The caller corrected the house number: it is ${correction.to}, not ${correction.from}. ` +
      "The street in the call notes above already has the corrected number. Your whole reply: " +
      "read that street address back once, the house number digit by digit, and ask if that's " +
      "right. Do not ask for the house number again.]"
    );
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

/** "that's not my name", "you got my name wrong", "wrong name". */
const NAME_DISPUTED =
  /\b(?:not|isn'?t|wasn'?t)\s+my\s+(?:first\s+|last\s+)?name\b|\bwrong\s+name\b|\bmy\s+name\s+(?:is\s+not|isn'?t|is\s+wrong)\b|\b(?:got|have|said|heard|saying|spelled|spelling|spell)\s+my\s+name\s+wrong\b|\bmispronounc/i;

/**
 * 2026-10-23, tester call: "My name is Yash", transcribed as "Josh". The
 * caller corrected it and it was transcribed as "Josh" again, so every
 * correction by voice only repeated the mistake, and the notes kept handing
 * Grace "Josh" with "never ask again for anything listed here".
 *
 * When the caller says the name is wrong, either in words ("that's not my
 * name") or by negating the very name in the notes ("no, not Josh"), the one
 * way out that does not depend on hearing the name again is the letters.
 * Skipped when this same reply already spells it, since that IS the fix.
 */
export function nameDisputeNote(
  callerTexts: readonly string[],
  notedFirstName: string | null,
): string | null {
  const latest = (callerTexts.at(-1) ?? "").trim();
  if (!latest || spelledWordsIn(latest, true).length > 0) {
    return null;
  }
  const negatedTheNotedName =
    notedFirstName !== null &&
    new RegExp(
      `\\b(?:not|isn'?t|wasn'?t)\\s+${notedFirstName.toLowerCase().replace(/[^a-z'-]/g, "")}\\b`,
      "i",
    ).test(latest);
  if (!NAME_DISPUTED.test(latest) && !negatedTheNotedName) {
    return null;
  }
  return (
    "[The caller is telling you their name is wrong. The name in the call notes above is NOT " +
    "confirmed: ignore it and do not say it again. Your whole reply: a short sorry, then ask them " +
    "to spell their first name letter by letter. Use exactly the letters they give, never a " +
    "familiar-sounding name instead.]"
  );
}

/**
 * 2026-10-23, tester (Yash): "it is better than before but still grace
 * assumes the spelling. If a customer repeats their name we can get grace to
 * ask if she can repeat the name's alphabet." A caller who says their name a
 * second time, without spelling it, is usually saying it again because it
 * was misheard; saying it a third time will not help, the letters will.
 * Not when they are changing it (nameUpdateNote), already spelling it, or
 * Grace has already asked for a spelling.
 */
export function nameRepeatedNote(
  callerTexts: readonly string[],
  agentTexts: readonly string[],
  notedName: string | null = null,
): string | null {
  const latest = (callerTexts.at(-1) ?? "").trim();
  if (!latest || NAME_UPDATE.test(latest) || spelledWordsIn(latest, true).length > 0) {
    return null;
  }
  if (agentTexts.some((text) => /\bspell\b/i.test(text))) {
    return null;
  }
  const now = statedNameAt([latest]);
  const before = statedNameAt(callerTexts.slice(0, -1));
  if (!now || !before) {
    return saidTheNotedNameUnasked(latest, agentTexts.at(-1) ?? "", notedName)
      ? NAME_REPEATED
      : null;
  }
  // "my name is akash" then "it's akash kumar" is the last name arriving,
  // not the name being misheard.
  const [nowFirst, ...nowRest] = now.value.toLowerCase().split(/\s+/);
  const [beforeFirst, ...beforeRest] = before.value.toLowerCase().split(/\s+/);
  if (nowFirst === beforeFirst && nowRest.join(" ") !== beforeRest.join(" ")) {
    return null;
  }
  return NAME_REPEATED;
}

const NAME_REPEATED =
  "[The caller has said their name again, so it may have been misheard. Your whole reply: " +
  "ask them to spell their first name, letter by letter. Then use exactly the letters they " +
  "give, never a familiar-sounding name instead.]";

/**
 * 2026-10-23, test call through the live pipeline: "yash patel" answered the
 * name question, then "yash patel" again when Grace asked for the street.
 * Neither has a cue ("my name is"), so the check above never saw a name, and
 * Grace asked for the address again. The bare name in the notes, said again
 * when Grace had not asked for it, is the same signal.
 */
function saidTheNotedNameUnasked(
  latest: string,
  lastAgentText: string,
  notedName: string | null,
): boolean {
  if (!notedName || NAME_QUESTION.test(lastAgentText)) {
    return false;
  }
  const words = latest
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return words.length > 0 && words.every(canBeName) && words.join(" ") === notedName.toLowerCase();
}

/** "can you update my full name", "change the name to", "fix my last name". */
const NAME_UPDATE =
  /\b(?:update|change|correct|fix|edit|spell)\s+(?:my|the|his|her)\s+(?:full\s+|first\s+|last\s+)?name\b|\bname\s+(?:should be|is actually|needs to be)\b/i;

/**
 * 2026-10-23, client call: after "you're all set", the caller asked "can you
 * update my full name" and spelled it. Grace confirmed the name and then
 * asked for the street address again, which the caller had already given and
 * confirmed. A name update is about the name; nothing else is reopened.
 */
export function nameUpdateNote(callerTexts: readonly string[]): string | null {
  const latest = (callerTexts.at(-1) ?? "").trim();
  if (!latest || !NAME_UPDATE.test(latest)) {
    return null;
  }
  return (
    "[The caller is updating their NAME only. Say the corrected name back once, spelled out, " +
    "using the call notes above. Do NOT ask again for the address, the phone number, or anything " +
    "else already given, and do not restart the intake. If their request was already saved, save " +
    "the corrected name with createCustomer using the same phone and address.]"
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
