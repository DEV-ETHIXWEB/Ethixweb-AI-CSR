/**
 * A caller asking about a coupon, a discount or a special offer.
 *
 * "A coupon question skipped" is on the client's own list of what went
 * wrong (see prompt-layers' header). The prompt already says to mention a
 * current coupon that fits the job, and the answer-first clause already
 * fires when a caller asks anything while intake is still running. Neither
 * held: in vendor-04 the caller opened with "I saw a hundred dollar
 * discount", asked twice more, and heard the flat-rate pricing line three
 * times with the coupon never named once. The answer-first clause says to
 * answer first but not what the answer is, and naming the coupon means
 * reaching into the approved knowledge.
 *
 * So the coupon gets what every other rule that had to hold got: its own
 * deterministic note, on the turn the caller asks.
 */

/**
 * The caller is asking about money off, in any of the forms they use. A
 * bare price question is NOT one of these: the prompt's flat-rate answer is
 * the right reply to that, and this note would talk over it.
 */
const ASKS_ABOUT_A_DISCOUNT =
  /\b(?:coupons?|discounts?|promo(?:tion|tions|s)?|specials?|offers?|deals?|voucher|rebate)\b|\$\s?\d+\s*off\b|\b\d+\s*(?:dollars?|bucks)\s*off\b|\b(?:hundred|fifty|ten|twenty|twenty[- ]five)\s*(?:dollars?)?\s*(?:off|discount)\b|\bmoney off\b|\banything off\b|\bcheaper rate\b/i;

/** True when this turn asks about money off. */
export function asksAboutADiscount(text: string): boolean {
  return ASKS_ABOUT_A_DISCOUNT.test(text);
}

/**
 * Grace has already named a figure off. A dollar amount or a percentage in
 * one of her own replies is the coupon being answered; without this the
 * note would fire again on every later turn of the same call.
 */
const NAMED_A_FIGURE = /\$\s?\d+|\b\d+\s*(?:dollars?|%|percent)\b|\b(?:hundred|fifty|ten|twenty)\b/i;

export function alreadyNamedACoupon(agentTexts: readonly string[]): boolean {
  return agentTexts.some((text) => NAMED_A_FIGURE.test(text));
}

/**
 * Deliberately does NOT take over the whole reply, unlike most notes here.
 * The caller is mid-intake and the turn still has a job to do; the coupon
 * is one sentence added in front of it, not a replacement for it.
 */
export const COUPON_QUESTION_NOTE =
  "[the caller is asking about a discount or coupon. Before anything else in " +
  "this reply, name the current coupon from your approved business knowledge " +
  "that fits their job, with its actual amount, in ONE short sentence. If no " +
  "current coupon fits, say plainly that there is nothing running for that " +
  "job right now. Do not give a price and do not repeat the flat-rate " +
  "sentence. Then carry on with whatever you were asking before.]";
