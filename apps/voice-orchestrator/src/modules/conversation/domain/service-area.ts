/**
 * Deterministic service-area answers from the business's OWN approved ZIP
 * list, so coverage is never left to the model's sense of geography.
 *
 * FOUND in the qa-suite regression sweep, run to run: with the client's 92
 * ZIPs in the approved knowledge and an explicit instruction that any
 * Washington town gets the job, Grace still intermittently told a caller in
 * Carnation (98014, King County) "Carnation's just outside our service area
 * right now... good luck." Her general knowledge that Carnation is not
 * "Seattle" kept beating the written rule, and getServiceAreas could not
 * save her because its handler is a stub that always answers true. A wrongly
 * refused customer is lost for good, which is exactly the class of mistake
 * this codebase puts behind a code-level guard rather than prompt wording.
 *
 * The verdict comes from the business's data, not from anything hardcoded
 * here:
 *   confirmed  the ZIP is on the approved list;
 *   likely     it shares a three-digit prefix with ZIPs on the list (the
 *              same USPS sectional centre, e.g. 98014 next to 98001-98092),
 *              so take the job and let the team confirm;
 *   outside    neither.
 * No approved list at all means no verdict, and behaviour is unchanged.
 */

export type ServiceAreaVerdict = "confirmed" | "likely" | "outside";

const DIGIT_WORDS: Record<string, string> = {
  zero: "0",
  oh: "0",
  o: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
};

/**
 * Only a comma-separated run of at least three five-digit numbers counts as
 * a ZIP list. A lone five-digit number in prose is usually a street address
 * ("14101 Interurban Ave"), and treating that as a covered ZIP would mark an
 * unrelated part of the country as in-area.
 */
export function coveredZipsFromPrompt(systemPrompt: string): Set<string> {
  const marker = "[service_area]";
  const start = systemPrompt.indexOf(marker);
  if (start === -1) {
    return new Set();
  }
  const afterMarker = systemPrompt.slice(start + marker.length);
  const nextSection = afterMarker.search(/\n- \[|\n\n\[/);
  const section = nextSection === -1 ? afterMarker : afterMarker.slice(0, nextSection);
  const lists = section.match(/\b\d{5}(?:\s*,\s*\d{5}){2,}/g) ?? [];
  return new Set(lists.flatMap((list) => list.match(/\d{5}/g) ?? []));
}

export function classifyZip(zip: string, covered: ReadonlySet<string>): ServiceAreaVerdict | null {
  if (covered.size === 0 || !/^\d{5}$/.test(zip)) {
    return null;
  }
  if (covered.has(zip)) {
    return "confirmed";
  }
  const coveredPrefixes = new Set(Array.from(covered, (value) => value.slice(0, 3)));
  return coveredPrefixes.has(zip.slice(0, 3)) ? "likely" : "outside";
}

/** The ordinal words street-name.ts pairs with a tens word; see readNumberGroup. */
const ORDINAL_UNITS = new Set([
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
  "ninth",
]);

const TEEN_WORDS: Record<string, number> = {
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const TENS_WORDS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  // Deepgram writes what it hears, and this is a common real spelling.
  fourty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

/**
 * One spoken number group as digits, and how many tokens it consumed:
 * "forty five" -> 45, "twelve" -> 12, "two hundred fifty" -> 250, "seven" -> 7.
 */
function readNumberGroup(
  cores: readonly string[],
  at: number,
): { digits: string; consumed: number } | null {
  const word = cores[at] ?? "";
  if (/^\d+$/.test(word)) {
    return { digits: word, consumed: 1 };
  }
  const tens = TENS_WORDS[word];
  if (tens !== undefined) {
    // "twenty fifth street" is a numbered STREET, not a number: street-name.ts
    // owns that conversion ("twenty fifth" -> "25th") and needs both words
    // intact to do it. Converting the "twenty" here left it "20 fifth" and
    // the street came out as "5th" — caught by that module's own test.
    if (ORDINAL_UNITS.has(cores[at + 1] ?? "")) {
      return null;
    }
    const ones = DIGIT_WORDS[cores[at + 1] ?? ""];
    // "forty five" is 45; "forty oh" is not a number anyone says, so a zero
    // after a tens word is left to start its own group.
    if (ones !== undefined && ones !== "0") {
      return { digits: String(tens + Number(ones)), consumed: 2 };
    }
    return { digits: String(tens), consumed: 1 };
  }
  const teen = TEEN_WORDS[word];
  if (teen !== undefined) {
    return { digits: String(teen), consumed: 1 };
  }
  const ones = DIGIT_WORDS[word];
  if (ones === undefined) {
    return null;
  }
  if ((cores[at + 1] ?? "") !== "hundred") {
    return { digits: ones, consumed: 1 };
  }
  // "two hundred" -> 200, "two hundred fifty six" -> 256.
  let value = Number(ones) * 100;
  let consumed = 2;
  const after = readNumberGroup(cores, at + 2);
  if (after && after.digits.length <= 2) {
    value += Number(after.digits);
    consumed += after.consumed;
  }
  return { digits: String(value), consumed };
}

/**
 * Spoken numbers become digits: "nine eight zero one four" -> "98014", and
 * "forty five twelve" -> "4512".
 *
 * The compound half is 2026-10-22, from running every realistic address form
 * through this parser instead of assuming: "forty five twelve maple street"
 * came out as "5 twelve maple street" and "fifty three twelve one fifty six
 * drive northeast" (a real 2026-10-14 tester utterance, quoted in
 * save-readiness.ts's own comment) as "1 fifty 6 drive northeast". Only
 * single digits were mapped, so "forty" and "twelve" survived as words and
 * the parser took the stray "5" for the house number. That is worse than
 * the 4512-became-512 bug the tester reported: it does not lose a digit, it
 * invents a different address and states it as fact.
 *
 * Adjacent groups CONCATENATE rather than add, which is how people read a
 * house number or a phone number aloud ("forty five" + "twelve" = 4512, not
 * 57). A run longer than five digits is a house number and a numbered street
 * said without a pause ("fifty three twelve one fifty six"); that comes out
 * as one long number, no street parses from it, and the prompt's own rule
 * takes over and asks for the two parts separately — an honest "say that
 * again" where this used to assert a wrong address.
 */
export function collapseSpokenDigits(text: string): string {
  // Split on hyphens as well as spaces. Our OWN read-back output is
  // hyphenated ("1-2-oh-oh Pine Street") and several callers of this
  // function check whether the agent has already said a house number by
  // looking for its digits in that output — found 2026-10-22 when the first
  // version of this rewrite stopped recognising it and the address
  // read-back fired a second time as a "correction".
  const words = text
    .toLowerCase()
    .split(/[\s-]+/)
    .filter(Boolean);
  const cores = words.map(stripEdges);
  const out: string[] = [];
  let index = 0;
  while (index < words.length) {
    const first = readNumberGroup(cores, index);
    if (!first) {
      out.push(words[index]!);
      index += 1;
      continue;
    }
    // Consume this group and every group immediately after it, joining their
    // digits: that is how a house number or a phone number is read aloud.
    let digits = "";
    let cursor = index;
    while (cursor < words.length) {
      const group = readNumberGroup(cores, cursor);
      if (!group) {
        break;
      }
      digits += group.digits;
      cursor += group.consumed;
    }
    // Punctuation on the edges of the run is kept, so "ninety-eight, oh one"
    // reads the same as it would without it.
    const lead = words[index]!.match(/^[^a-z0-9]*/)?.[0] ?? "";
    const trail = words[cursor - 1]!.match(/[^a-z0-9]*$/)?.[0] ?? "";
    out.push(`${lead}${digits}${trail}`);
    index = cursor;
  }
  return out.join(" ");
}

/** The alphanumeric core of a word, with leading and trailing punctuation removed. */
function stripEdges(word: string): string {
  return word.replace(/^[^a-z0-9]*/, "").replace(/[^a-z0-9]*$/, "");
}

const STREET_CONTEXT =
  /^\s+(n|s|e|w|ne|nw|se|sw|north|south|east|west|[a-z]+\s+(st|street|ave|avenue|rd|road|way|blvd|boulevard|dr|drive|ln|lane|pl|place|ct|court|hwy|highway))\b/;

/**
 * The ZIP a caller just gave, plus a verdict, or null when there is nothing
 * safe to say.
 *
 * Deliberately lopsided, because a false "outside" loses a real customer and
 * a false "inside" costs one callback:
 *  - a number followed by street words is a house number, never a ZIP
 *    ("13005 SE 245th Street, Kent" must not be read as ZIP 13005);
 *  - an "outside" verdict is only ever returned when the caller actually
 *    said "zip" or "postal". A bare number that merely looks like a ZIP can
 *    confirm coverage but can never refuse it.
 */
const US_STATE_NAMES =
  /\b(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming)\b/i;

export function detectServiceAreaFromTranscript(
  transcript: string,
  covered: ReadonlySet<string>,
): { zip: string; verdict: ServiceAreaVerdict } | null {
  if (covered.size === 0) {
    return null;
  }
  const text = collapseSpokenDigits(transcript);
  const saidZip = /\b(zip|zipcode|postal)\b/.test(text);
  const mentionsState = US_STATE_NAMES.test(text);
  for (const match of text.matchAll(/\b(\d{5})\b/g)) {
    const zip = match[1]!;
    const following = text.slice((match.index ?? 0) + zip.length);
    if (STREET_CONTEXT.test(following)) {
      continue;
    }
    const verdict = classifyZip(zip, covered);
    if (verdict === null) {
      continue;
    }
    if (verdict === "outside" && !saidZip && !mentionsState) {
      continue;
    }
    return { zip, verdict };
  }
  return null;
}
