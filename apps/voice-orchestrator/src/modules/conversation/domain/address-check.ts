import { readFileSync } from "node:fs";
import { join } from "node:path";
import { editDistanceAtMostOne } from "./name-grounding";
import { collapseSpokenDigits } from "./service-area";
import { STREET_SUFFIXES, streetCoreName, tokenizeStreet } from "./street-name";

/**
 * Client feedback: a made-up street plus a real ZIP code was accepted. There
 * is no free live address API, so this checks the street NAME against an
 * offline index of every road the US Census lists per ZIP (King and Pierce
 * County, see scripts/build-street-index.ts). It cannot prove a house number
 * exists, and it never rejects: a street missing from the index may be a new
 * road or a misheard name, so the verdict only tells the model whether to ask
 * the caller to spell the street once more.
 */

export interface StreetIndex {
  zips: Record<string, string[]>;
}

export type AddressCheck =
  | { kind: "found"; street: string; zip: string | null }
  | { kind: "close"; street: string; zip: string; suggestion: string }
  | { kind: "wrong_zip"; street: string; zip: string; foundIn: string[] }
  | { kind: "not_found"; street: string; zip: string | null };

let cachedIndex: StreetIndex | null | undefined;

/** Loads the bundled index once. Returns null when the file is missing so the check simply switches itself off. */
export function loadStreetIndex(): StreetIndex | null {
  if (cachedIndex !== undefined) {
    return cachedIndex;
  }
  try {
    cachedIndex = JSON.parse(
      readFileSync(join(__dirname, "data", "wa-street-index.json"), "utf8"),
    ) as StreetIndex;
  } catch {
    cachedIndex = null;
  }
  return cachedIndex;
}

const NUMBER_WORDS = /^(hundred|thousand|zero|one|two|three|four|five|six|seven|eight|nine|ten)$/;
const HOUSE_NUMBER = /^\d{1,6}$/;
const MAX_NAME_TOKENS = 4;

/**
 * The most recent "<house number> <street name> <street type>" in the text,
 * or null. Needing a house number is deliberate: "it's on 5th Avenue" is not
 * an address yet, and guessing at loose phrases would flag honest callers.
 */
export function extractStreet(text: string): { name: string; core: string } | null {
  const tokens = collapseSpokenDigits(text)
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/-/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  let found: { name: string; core: string } | null = null;
  for (let house = 0; house < tokens.length; house += 1) {
    if (!HOUSE_NUMBER.test(tokens[house] ?? "")) {
      continue;
    }
    for (let suffix = house + 2; suffix <= house + 1 + MAX_NAME_TOKENS + 1; suffix += 1) {
      if (!STREET_SUFFIXES.has(tokens[suffix] ?? "")) {
        continue;
      }
      const nameTokens = tokens.slice(house + 1, suffix);
      if (
        nameTokens.length === 0 ||
        nameTokens.length > MAX_NAME_TOKENS ||
        nameTokens.some((token) => HOUSE_NUMBER.test(token) || NUMBER_WORDS.test(token))
      ) {
        continue;
      }
      const name = tokenizeStreet(nameTokens.join(" ")).join(" ");
      const core = streetCoreName(`${name} ${tokens[suffix] ?? ""}`);
      if (core) {
        found = { name, core };
      }
      break;
    }
  }
  return found;
}

export function checkAddress(
  callerText: string,
  zip: string | null,
  index: StreetIndex,
): AddressCheck | null {
  const street = extractStreet(callerText);
  if (!street) {
    return null;
  }
  if (zip === null) {
    const anywhere = Object.values(index.zips).some((names) => names.includes(street.core));
    return anywhere
      ? { kind: "found", street: street.core, zip: null }
      : { kind: "not_found", street: street.core, zip: null };
  }
  const inZip = index.zips[zip];
  if (!inZip) {
    return null;
  }
  if (inZip.includes(street.core)) {
    return { kind: "found", street: street.core, zip };
  }
  const foundIn = Object.entries(index.zips)
    .filter(([, names]) => names.includes(street.core))
    .map(([candidate]) => candidate)
    .slice(0, 5);
  if (foundIn.length > 0) {
    return { kind: "wrong_zip", street: street.core, zip, foundIn };
  }
  if (street.core.length >= 5) {
    const suggestion = inZip.find((name) => editDistanceAtMostOne(name, street.core));
    if (suggestion) {
      return { kind: "close", street: street.core, zip, suggestion };
    }
  }
  return { kind: "not_found", street: street.core, zip };
}

/** Stable identity of a verdict, so the model is only told about a CHANGE and never nagged twice about the same street. */
export function addressCheckKey(check: AddressCheck | null): string {
  return check ? `${check.kind}|${check.street}|${check.zip ?? ""}` : "";
}

export function describeAddressCheck(check: AddressCheck): string | null {
  switch (check.kind) {
    case "found":
      return null;
    case "close":
      return (
        `[Address check: the street "${check.street}" is not in our records for ZIP ${check.zip}, ` +
        `but "${check.suggestion}" is. Ask once if they meant ${check.suggestion}, and have them spell it.]`
      );
    case "wrong_zip":
      return (
        `[Address check: "${check.street}" exists, but not in ZIP ${check.zip}. ` +
        `Ask them once to confirm the ZIP code.]`
      );
    case "not_found":
      return (
        `[Address check: the street "${check.street}"` +
        `${check.zip ? ` in ZIP ${check.zip}` : ""} was not found in our records. It may be misheard. ` +
        `Ask them once to spell the street name and confirm the ZIP. Never say the address is invalid. ` +
        `If they confirm it again, accept it as they said it and mention in the lead notes that the address could not be checked.]`
      );
  }
}
