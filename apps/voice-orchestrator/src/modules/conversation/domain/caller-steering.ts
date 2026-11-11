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

/**
 * The caller is telling Grace her audio is not reaching them: "I'm not able
 * to hear your voice", "you're breaking up", "it doesn't come through
 * properly". 2026-11-11, Akash's test calls: the model read this as the
 * caller's state of mind ("It sounds like you're feeling confused about
 * communication") instead of a bad line.
 */
const CANNOT_HEAR =
  /\b(?:can(?:'?t|not)|could(?:n'?t| not)|not able to|unable to|didn'?t|did not|don'?t|do not)\s+(?:really\s+)?hear\s+(?:you|your voice|anything|what you|a thing)\b|\b(?:you(?:'re| are)|your voice(?: is)?|the (?:line|call|audio|sound|voice|connection)(?: is)?)\s+(?:really\s+|so\s+|kind of\s+|very\s+)?(?:breaking up|cutting (?:out|off)|choppy|garbled|robotic|bad|not clear|unclear|not coming through)\b|\bhallucinat\w*|\b(?:doesn'?t|don'?t|does not|do not|isn'?t|is not)\s+come\w*\s+(?:through|properly|clearly)\b|^\s*(?:hello\W*)+(?:grace\W*)?(?:are\s+)?you\s+there\W*$/i;

export function cannotHearGrace(text: string): boolean {
  return CANNOT_HEAR.test(text);
}

/**
 * QA steer-02: "hi chris how are you" got "Chris isn't who you've reached,
 * though, this is Grace." A caller who greets Grace by another name (they
 * expected someone else, or misheard) gets a light "this is Grace" without
 * the name repeated back, and the name is never taken as theirs.
 */
const GREETED_BY_NAME =
  /^\W*(?:hi|hey|hello|hiya)\W+([a-z]{2,})\b(?:\W*$|\W+(?:how|how's|hows|good|what's|whats)\b)/i;
const NOT_A_NAME = new Set([
  "grace",
  "there",
  "yes",
  "yeah",
  "yep",
  "no",
  "ok",
  "okay",
  "good",
  "um",
  "uh",
  "again",
  "everyone",
  "all",
  "guys",
  "folks",
  "team",
  "sir",
  "maam",
  "madam",
  "mam",
  "how",
  "i",
  "my",
  "this",
  "is",
  "it",
  "we",
  "so",
  "and",
  "um",
  "morning",
  "afternoon",
  "evening",
]);

export function nameCallerGreetedHerWith(text: string): string | null {
  const match = GREETED_BY_NAME.exec(text.trim());
  const name = match?.[1]?.toLowerCase() ?? null;
  return name && !NOT_A_NAME.has(name) ? name : null;
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

/**
 * 2026-11-11, Akash's call: "can you just connect me to the human please"
 * matched nothing above, so neither the screen nor the transfer rule ran and
 * the model put a caller with no reason straight through.
 */
const ALSO_ASKS_FOR_A_PERSON =
  /\bconnect (?:me|us)\b|\b(?:i|we)(?:'d| would)? (?:want|need|like) (?:to (?:talk|speak) (?:to|with) )?(?:a |an |the )?(?:human|real person|person|manager|owner|operator|representative|rep|live (?:agent|person))\b|\b(?:speak|talk) (?:to|with) (?:a |an |the )?operator\b|\blive (?:agent|person|operator)\b/i;

/**
 * "Is this a human?" or "are you a real person?" asks what Grace is (the
 * prompt's "are you AI" answer), not to be put through to someone.
 */
const ASKS_WHAT_GRACE_IS =
  /\b(?:are you|is this|is that|am i (?:talking|speaking) (?:to|with))\s+(?:a |an )?(?:real |actual )?(?:person|human|robot|bot|ai|machine)\b(?:\s+or\s+(?:a |an )?(?:real |actual )?(?:person|human|robot|bot|ai|machine)\b)?/gi;

/** True when the caller has asked to be put through to a person. */
export function asksForAPerson(text: string): boolean {
  const request = text.replace(ASKS_WHAT_GRACE_IS, " ");
  return ASKS_FOR_A_PERSON.test(request) || ALSO_ASKS_FOR_A_PERSON.test(request);
}

/**
 * Someone selling TO the business rather than calling about plumbing. The
 * giveaway is almost never the word "sales": it is a pitch aimed at the
 * company itself (your listing, your ranking, businesses like yours) or an
 * ask for whoever makes decisions, with no plumbing anywhere in it.
 */
const SOLICITATION =
  /\b(?:seo|google (?:ads?|listings?|business(?: profile| listing)?|my business|ranking|visibility)|search ranking|digital marketing|web ?site redesign|lead gen\w*|more (?:calls|leads|customers|clients)|rank (?:you |your )?(?:higher|number one|#1)|businesses like yours|companies like yours|shops like yours|contractors like you|merchant (?:services|account)|card processing|payment processing|business loan|working capital|insurance quote|advertis\w+|promot\w+ your|list your business|directory|franchis\w+|wholesale|distributor|supplier|partnership opportunity|quick question about your (?:business|company|website)|software (?:company|companies|solutions?|products?|platform|tool)|marketing (?:agency|company|firm)|(?:wanted|want|like) to introduce|(?:book|schedule|set up) (?:a |an )?(?:quick |short |free )?demo|free trial|crm)\b/i;

/** True when this reads as somebody selling to the business. */
export function looksLikeSolicitation(texts: readonly string[]): boolean {
  return texts.some((text) => SOLICITATION.test(text));
}

/**
 * 2026-11-11, Akash's call: "I'm from the software company, I wanted to
 * introduce..." matched no sales phrase, Grace declined it on her own, and
 * then "please connect me, it's very important" was put straight through
 * as an insistent caller. Once Grace has said the sales decline, the call
 * IS a sales call for the rest of it, whatever the caller says next.
 */
const SALES_DECLINE = /\b(?:can(?:'|no)?t pass (?:offers?|that|it|anything) along|(?:just|only) for (?:our )?plumbing customers)\b/i;

/** True when Grace has already turned this caller down as a sales call. */
export function declinedAsSales(agentTexts: readonly string[]): boolean {
  return agentTexts.some((text) => SALES_DECLINE.test(text));
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
  "with a plumbing problem. Do not transfer and do not save a request. Be " +
  "warm: thank them for thinking of the business, say kindly that this line " +
  "is just for plumbing customers so you cannot pass offers along, and wish " +
  "them a great day. Two short sentences at most. Stay courteous, never rude, " +
  "and do not argue or ask them questions. If they insist, say it is urgent " +
  "or important, or ask again for a person, still do not transfer: kindly " +
  "say again that this line is just for plumbing customers.]";

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
// 2026-11-11, Akash's call: "can you just connect me to the human please",
// with no reason given, went straight through. In a question, "just" is a
// polite softener (and the one a salesperson uses too), so it is screened
// once. Said as a command opening the sentence ("Just put me through,
// please."), it is still impatience and goes through at once. A caller who
// asks a second time is put through either way: the screen is asked once.
const INSISTENT =
  /\b(?:right now|immediately|straight ?away|at once|this instant)\b|(?:^|[.!?]\s*)(?:please,?\s+)?just (?:give|get|put|transfer|connect)\b|\b(?:already|again) asked\b|\bi said\b/i;

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
 * The screen is the question asked IN REPLY to a request for a person.
 * QA screen1111-09: an ordinary intake "what's going on with the plumbing?"
 * earlier in the call counted as the screen, so a later bare "connect me
 * to the human" went straight through.
 */
export function screenedSinceAskingForAPerson(
  turns: ReadonlyArray<{ speaker: string; text: string }>,
): boolean {
  const askedAt = turns.findIndex((turn) => turn.speaker === "caller" && asksForAPerson(turn.text));
  return (
    askedAt >= 0 &&
    screeningQuestionAsked(
      turns
        .slice(askedAt + 1)
        .filter((turn) => turn.speaker === "agent")
        .map((turn) => turn.text),
    )
  );
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
  'transferToHuman in THIS reply, with one short line like "Sure, connecting ' +
  'you now." Do not ask anything else, do not take their name or address, ' +
  "and never say you cannot transfer them.]";

/**
 * 2026-11-11, screen1111-08 and vendor-06 on the real model: the screen got
 * a deterministic note and "transfer at once" never did, so the commonest
 * case of all rested on the prompt alone.
 *
 * "I need to speak to a person right now." The code correctly refused to
 * screen it (see insistsOnAPerson), but nothing then TOLD Grace to
 * transfer, and the screening exception added to the prompt the same day
 * reads as applying to anyone who has given no reason yet. So she asked
 * "Before I connect you, can you tell me what's going on?" and the caller
 * was screened by the prompt after the code had decided not to.
 *
 * This is the other half of SCREEN_BEFORE_TRANSFER_NOTE: when a request for
 * a person is explicitly NOT to be screened, that is now said out loud.
 */
export const TRANSFER_NOW_NOTE =
  "[this caller has asked for a person and must NOT be screened or asked " +
  "anything first. Call transferToHuman in THIS reply, with one short line " +
  'like "Sure, connecting you now." Do not ask what it is about, do not take ' +
  "their name, address or number, and never say you cannot transfer them.]";
