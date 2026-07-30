/**
 * docs/13-implementation-backlog.md `customers` module §2: "Phone-number
 * normalization to E.164 (shared utility, used before any phone-based
 * lookup/write)" — the docs themselves call for this to be shared, not
 * reimplemented per module. A leading `+`, then 1-15 digits, first digit
 * non-zero. A plain regex rather than a full phone-parsing library (e.g.
 * libphonenumber-js, not a confirmed dependency of this app): every caller
 * here already has an E.164 string to validate the SHAPE of, never a
 * human-typed number to parse.
 */
export const E164_PATTERN = /^\+[1-9]\d{1,14}$/;

export function isValidE164(value: string): boolean {
  return E164_PATTERN.test(value);
}
