/**
 * Street-name normalization, shared by the offline index builder
 * (scripts/build-street-index.ts) and the runtime address check, so both
 * sides reduce "NE 45th St", "Northeast Forty-Fifth Street" and
 * "45th Ave" to the same key: "45th". Street TYPE and direction are
 * dropped on purpose: speech-to-text and callers disagree on them far more
 * often than on the name itself, and an invented street name is what this
 * needs to catch.
 */

const DIRECTIONALS = new Set([
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

export const STREET_SUFFIXES = new Set([
  "st",
  "street",
  "ave",
  "av",
  "avenue",
  "blvd",
  "boulevard",
  "rd",
  "road",
  "dr",
  "drive",
  "ln",
  "lane",
  "way",
  "pl",
  "place",
  "ct",
  "court",
  "cir",
  "circle",
  "ter",
  "terrace",
  "pkwy",
  "parkway",
  "hwy",
  "highway",
  "trl",
  "trail",
  "loop",
  "sq",
  "square",
  "aly",
  "alley",
  "walk",
  "pass",
  "run",
  "row",
  "path",
  "cv",
  "cove",
  "xing",
  "crossing",
  "brg",
  "bridge",
  "pt",
  "point",
]);

const ORDINAL_UNITS: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
};
const ORDINAL_TEENS: Record<string, number> = {
  tenth: 10,
  eleventh: 11,
  twelfth: 12,
  thirteenth: 13,
  fourteenth: 14,
  fifteenth: 15,
  sixteenth: 16,
  seventeenth: 17,
  eighteenth: 18,
  nineteenth: 19,
};
const ORDINAL_TENS: Record<string, number> = {
  twentieth: 20,
  thirtieth: 30,
  fortieth: 40,
  fiftieth: 50,
  sixtieth: 60,
  seventieth: 70,
  eightieth: 80,
  ninetieth: 90,
};
const CARDINAL_TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

function ordinalSuffix(value: number): string {
  const lastTwo = value % 100;
  if (lastTwo >= 11 && lastTwo <= 13) {
    return "th";
  }
  return ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[value % 10] ?? "th";
}

const ordinal = (value: number): string => `${value}${ordinalSuffix(value)}`;

/** "forty fifth" -> "45th", "fifth" -> "5th", "twentieth" -> "20th". Everything else passes through. */
function spokenOrdinals(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] ?? "";
    const next = tokens[i + 1] ?? "";
    const tens = CARDINAL_TENS[token];
    if (tens !== undefined && ORDINAL_UNITS[next] !== undefined) {
      out.push(ordinal(tens + (ORDINAL_UNITS[next] ?? 0)));
      i += 1;
    } else if (ORDINAL_UNITS[token] !== undefined) {
      out.push(ordinal(ORDINAL_UNITS[token] ?? 0));
    } else if (ORDINAL_TEENS[token] !== undefined) {
      out.push(ordinal(ORDINAL_TEENS[token] ?? 0));
    } else if (ORDINAL_TENS[token] !== undefined) {
      out.push(ordinal(ORDINAL_TENS[token] ?? 0));
    } else {
      out.push(token);
    }
  }
  return out;
}

const WORD_ALIASES: Record<string, string> = {
  saint: "st",
  junior: "jr",
  mount: "mt",
  "&": "and",
};

export function tokenizeStreet(raw: string): string[] {
  const cleaned = raw
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/-/g, " ")
    .replace(/[^a-z0-9\s]/g, " ");
  return spokenOrdinals(cleaned.split(/\s+/).filter(Boolean)).map(
    (token) => WORD_ALIASES[token] ?? token,
  );
}

/**
 * "NE 45th St" -> "45th"; "Martin Luther King Jr Way S" -> "martin luther
 * king jr"; "Zorblax Boulevard" -> "zorblax". Falls back to the whole
 * cleaned name when stripping would leave nothing (a street literally
 * named "Loop").
 */
export function streetCoreName(raw: string): string {
  const tokens = tokenizeStreet(raw);
  let end = tokens.length;
  let start = 0;
  while (end - start > 1 && DIRECTIONALS.has(tokens[end - 1] ?? "")) {
    end -= 1;
  }
  if (end - start > 1 && STREET_SUFFIXES.has(tokens[end - 1] ?? "")) {
    end -= 1;
  }
  while (end - start > 1 && DIRECTIONALS.has(tokens[end - 1] ?? "")) {
    end -= 1;
  }
  while (end - start > 1 && DIRECTIONALS.has(tokens[start] ?? "")) {
    start += 1;
  }
  return tokens.slice(start, end).join(" ");
}
