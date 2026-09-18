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

/** Spoken digits ("nine eight zero one four") become "98014"; everything else is left as it was. */
function collapseSpokenDigits(text: string): string {
  return text
    .toLowerCase()
    .replace(
      /\b(zero|oh|o|one|two|three|four|five|six|seven|eight|nine)\b/g,
      (word) => DIGIT_WORDS[word] ?? word,
    )
    .replace(/\b(\d)(?:[\s-]+(?=\d\b))/g, "$1");
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
export function detectServiceAreaFromTranscript(
  transcript: string,
  covered: ReadonlySet<string>,
): { zip: string; verdict: ServiceAreaVerdict } | null {
  if (covered.size === 0) {
    return null;
  }
  const text = collapseSpokenDigits(transcript);
  const saidZip = /\b(zip|zipcode|postal)\b/.test(text);
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
    if (verdict === "outside" && !saidZip) {
      continue;
    }
    return { zip, verdict };
  }
  return null;
}
