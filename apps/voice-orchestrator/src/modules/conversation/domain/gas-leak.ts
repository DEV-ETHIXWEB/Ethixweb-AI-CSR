/**
 * 2026-10-26, Yash's test call: a gas leak with kids upstairs. Grace asked
 * for his name and whether it was happening right now, and only said to leave
 * the building when he asked "what should I do here". The leak was heard as
 * "the gas is leaving ... aggressively", which matched none of the emergency
 * rules, so it was never put through either.
 *
 * Smelling or hearing gas always counts. Gas "leaking" counts unless what is
 * leaking is a gas appliance's water ("my gas water heater is leaking").
 */
const SENSED = /\b(?:smell\w*|stink\w*|hiss\w*|odou?r)\b/i;
const ESCAPING = /\b(?:leak\w*|leaving|escap\w*|everywhere)\b/i;
const APPLIANCE =
  /\bgas (?:water heater|heater|stove|range|oven|dryer|fireplace|grill|line install\w*|bill|meter reading|furnace)\b/i;
const NEGATED =
  /\bno gas (?:smell|leak|odou?r)\b|\bnot (?:a )?gas\b|\bdon'?t smell (?:any )?gas\b/i;

export function mentionsGasLeak(text: string): boolean {
  if (NEGATED.test(text)) {
    return false;
  }
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    const near = /\bgas\b/i.test(sentence) ? sentence : "";
    if (!near) {
      continue;
    }
    if (SENSED.test(near) || /\bgas (?:leak|smell)\b/i.test(near)) {
      return true;
    }
    if (ESCAPING.test(near) && !APPLIANCE.test(near)) {
      return true;
    }
  }
  return false;
}
