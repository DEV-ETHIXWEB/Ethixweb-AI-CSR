/**
 * 2026-10-26, Yash's test calls. An elderly caller ("my son usually handles
 * this") started giving his address and asked "what was your name again",
 * and Grace said "I still need your name first". Another caller would not
 * give a name, and Grace asked for it three more times. Each of these is
 * read here so the turn's note can say what to do.
 */

const NAME_QUESTION =
  /\b(your name|who am i speaking|what'?s your name|can i (get|have|grab) your name|and your name|share your name|your first and last name)\b/i;

const DECLINES =
  /\b(?:don'?t|do not|won'?t|will not|not going to|rather not|prefer not to|no need to)\s+(?:want to\s+|wanna\s+)?(?:give|share|tell|say|provide)\b|\bnot giving\b|\bno name\b|\bwhy do you need my name\b|\brather not\b/i;

/** The caller turned down giving a name, in answer to Grace asking for it, at any point in the call. */
export function declinedTheirName(
  turns: ReadonlyArray<{ speaker: string; text: string }>,
): boolean {
  for (let i = 1; i < turns.length; i += 1) {
    const before = turns[i - 1]!;
    const now = turns[i]!;
    if (
      before.speaker === "agent" &&
      now.speaker === "caller" &&
      NAME_QUESTION.test(before.text) &&
      DECLINES.test(now.text)
    ) {
      return true;
    }
  }
  return false;
}

/** "what was your name again", "who am I speaking with": a question about Grace. */
export function asksGracesName(text: string): boolean {
  return /\bwhat(?:'s| is| was)\s+your name\b|\bwho (?:am i|are we) (?:speaking|talking) (?:to|with)\b|\bwho is this\b/i.test(
    text,
  );
}

/** The caller is starting to give the service address now. */
export function offersAddress(text: string): boolean {
  return /\b(?:my|the) address is\b|\bi live (?:at|on)\b|\bthe house is at\b/i.test(text);
}

/**
 * 2026-10-26, Yash's test call: "you charged me four hundred bucks ... I
 * want my money back and I want to talk to the owner" got only "Sure,
 * connecting you now". The transfer stays immediate; the line says sorry
 * for what went wrong first.
 */
const WANTS_A_PERSON =
  /\b(?:talk|speak) (?:to|with) (?:the |a |an |your |someone |somebody )?(?:owner|manager|person|human|supervisor|boss|someone|somebody|real person)\b|\breal person\b/i;
const UPSET =
  /\b(?:charged|refund|money back|ridiculous|overcharg\w*|unacceptable|angry|upset|furious|scam|ripped off|nobody (?:came|showed)|no one (?:came|showed))\b/i;

export function upsetAndWantsAPerson(text: string): boolean {
  return WANTS_A_PERSON.test(text) && UPSET.test(text);
}

/**
 * 2026-11-11, the client: every caller who asked for a human was put
 * straight through, and the on-call phone was ringing for marketing and SEO
 * pitches. They want the ones with a real plumbing reason to go through
 * exactly as before, and the rest screened out.
 *
 * The screen is ONE question and only when nothing is known yet. A caller
 * who has already said what is wrong, an emergency, an upset caller and a
 * customer already on file all keep the immediate transfer they have today:
 * making someone with a burst pipe answer a qualifying question first would
 * be a far worse bug than a salesperson getting through.
 *
 * Wider than WANTS_A_PERSON above, which only has to catch the upset case.
 * This also has to catch "get me a human", "put me through to someone" and
 * the sales opener "is the owner available", because those are the exact
 * words this is about.
 */
const ASKS_FOR_A_PERSON =
  /\b(?:talk|speak|chat) (?:to|with) (?:the |a |an |your |some ?one |some ?body )?(?:owner|manager|person|human|supervisor|boss|some ?one|some ?body|real person|rep|representative|agent)\b|\b(?:get|give|put) me (?:to |through to )?(?:a |an |the )?(?:human|real person|person|manager|owner|some ?one|some ?body)\b|\bput me through\b|\btransfer me\b|\b(?:is|are) (?:the |a )?(?:owner|manager|boss|decision[- ]maker)s? (?:available|around|in|there)\b|\b(?:who|whoever) (?:handles|looks after|is in charge of|takes care of|deals with)\b|\breal (?:person|human)\b/i;

/** True when the caller has asked to be put through to a person. */
export function asksForAPerson(text: string): boolean {
  return ASKS_FOR_A_PERSON.test(text);
}

/**
 * Someone selling TO the business rather than calling about plumbing. The
 * giveaway is almost never the word "sales": it is a pitch aimed at the
 * company itself (your listing, your ranking, businesses like yours) or an
 * ask for whoever makes decisions, with no plumbing anywhere in it.
 */
const SOLICITATION =
  /\b(?:seo|google (?:ads?|listings?|business(?: profile| listing)?|my business|ranking|visibility)|search ranking|digital marketing|web ?site redesign|lead gen\w*|more (?:calls|leads|customers|clients)|rank (?:you |your )?(?:higher|number one|#1)|businesses like yours|companies like yours|shops like yours|contractors like you|merchant (?:services|account)|card processing|payment processing|business loan|working capital|insurance quote|advertis\w+|promot\w+ your|list your business|directory|franchis\w+|wholesale|distributor|supplier|partnership opportunity|quick question about your (?:business|company|website))\b/i;

/** True when this reads as somebody selling to the business. */
export function looksLikeSolicitation(texts: readonly string[]): boolean {
  return texts.some((text) => SOLICITATION.test(text));
}

/**
 * Asked for a person with nothing known yet, so one question comes first.
 *
 * The question is genuinely one. Whatever they answer, if it is about
 * plumbing at all the next turn transfers: the point is to find out why
 * they are calling, not to talk them out of it. The client's words were
 * that a real service concern "should smoothly proceed with the transfer
 * according to the existing workflow".
 */
export const SCREEN_BEFORE_TRANSFER_NOTE =
  "[they have asked for a person but have not said what the call is about. " +
  "Ask ONE short, friendly question about what they need help with, and ask " +
  "nothing else this turn. Do not transfer yet, do not say you cannot " +
  "transfer, and do not say they must explain before you will. If their next " +
  "answer is about plumbing at all, or a job, a bill or a visit, transfer " +
  "immediately on that turn.]";

/**
 * Someone selling to the business. Declined politely and not put through,
 * and no request is saved: a lead the team has to read and discard is the
 * same interruption in a slower form.
 */
export const SOLICITATION_NOTE =
  "[this is a sales or marketing call aimed at the business, not a customer " +
  "with a plumbing problem. Do not transfer and do not save a request. Say " +
  "in one short, polite line that the team does not take sales calls on this " +
  "line, and close the call. Stay courteous, never rude, and do not argue or " +
  "ask them questions.]";

/**
 * 2026-11-11: someone who asks insistently is not a cold call to be
 * screened. "I need to talk to a person right now" is a caller at the end
 * of their patience, and a qualifying question is precisely the wrong
 * answer: the vendor calls of 2026-10-10 and 10-11 ignored three such
 * requests and that is why the immediate-transfer rule exists.
 *
 * A salesperson opens politely ("is the owner available?"). They do not
 * say "right now" or "just put me through".
 */
const INSISTENT =
  /\b(?:right now|immediately|straight ?away|at once|this instant)\b|\bjust (?:give|get|put|transfer|connect)\b|\b(?:already|again) asked\b|\bi said\b|\bplease just\b/i;

/** True when the request for a person is urgent or repeated, not a cold ask. */
export function insistsOnAPerson(text: string): boolean {
  return asksForAPerson(text) && INSISTENT.test(text);
}

/**
 * The screening question, in the forms Grace actually asks it. The same
 * pattern decides "has the screen already happened", so the screen can only
 * ever run once.
 */
const SCREENING_QUESTION =
  /\bwhat(?:'?s| is)? going on\b|\bgoing on with\b|\bwhat do you need\b|\bwhat (?:can|may) i (?:help|do)\b|\bhow can i help\b|\bwhat(?:'?s| is) (?:it|this|that|the call) about\b|\bwhat brings you\b|\bwhat (?:are|is) you (?:calling|needing)\b/i;

/** True when Grace has already put the one screening question to this caller. */
export function screeningQuestionAsked(agentTexts: readonly string[]): boolean {
  return agentTexts.some((text) => SCREENING_QUESTION.test(text));
}

/**
 * Money owed, which is a reason to reach a person and is not a plumbing
 * problem, so PROBLEM_WORDS does not carry it.
 */
const ABOUT_A_BILL = /\b(?:bill|billing|invoice|payment|charge|charged|account|owe|refund)\b/i;

/**
 * 2026-11-11, the full sweep (vendor-05): the screen asked its question, the
 * caller answered "My water heater is leaking", and Grace asked for their
 * name instead of transferring. The screen fires on the turn the caller asks
 * for a person; on the turn they ANSWER, nothing fired at all, so only the
 * prompt's own rule carried the transfer, and a prompt rule on its own does
 * not hold on this model. That is the whole reason this module exists.
 *
 * `problemDescribed` is the same reading of "gave a reason" the screen
 * itself uses, so a caller cannot be screened and then found to have no
 * reason by a different standard.
 */
export function answerEarnsTransfer(
  text: string,
  problemDescribed: (texts: readonly string[]) => boolean,
): boolean {
  return problemDescribed([text]) || ABOUT_A_BILL.test(text);
}

export const TRANSFER_AFTER_SCREEN_NOTE =
  "[you already asked this caller what they needed and they have just " +
  "answered. They asked for a person and they have now given a reason. Call " +
  "transferToHuman in THIS reply, with one short line like \"Sure, connecting " +
  "you now.\" Do not ask anything else, do not take their name or address, " +
  "and never say you cannot transfer them.]";
