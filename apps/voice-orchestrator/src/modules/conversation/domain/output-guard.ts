/**
 * Last line of defense on what Grace SAYS, applied to each speech segment
 * just before it is streamed to the voice. Prompt rules get followed most of
 * the time; these are the patterns the clients' real test calls showed
 * leaking through anyway, so they are enforced in code:
 *
 *  1. Reasoning leaked into speech: on a goodbye the model said "George
 *     already said goodbye and ended the call... Per the instructions, a
 *     caller who signs off gets let go". Dropped.
 *  2. Timing promises: "they'll call you back to lock in a time today",
 *     "Got you down for today". There is no live schedule, so any promise of
 *     a day or time is replaced with an honest line.
 *  3. Claiming an appointment change was made: "Let me get that cancelled
 *     for you." Nothing can be cancelled or rescheduled from a call.
 *  4. Address and phone read-backs "not clearly hearable" (client feedback):
 *     prefixed with the [slowly] delivery cue, which the voice runtime turns
 *     into a slower speaking rate.
 *
 * Rewrites are deliberately blunt and rare; every one is reported so it can
 * be counted and the prompt fixed at the source.
 */

import { editDistanceAtMostOne } from "./name-grounding";

export const SAFE_TIMING_LINE = "The team will confirm the timing with you.";
export const SAFE_PREFERENCE_LINE =
  "I'll note that preference, and the team will confirm the time.";
export const SAFE_CAUSE_LINE = "A technician will need to look at that to confirm.";

/**
 * Grace cannot send anyone: the team calls back and books the visit. Found
 * 2026-10-26 in the recorded calls and a live test: "help is on the way",
 * "someone's on the way to you now", "we're dispatching someone out to you
 * right now", "most emergency calls ... get there within 60 to 90 minutes".
 * Each is a promise of a visit nobody has agreed to.
 */
export const SAFE_DISPATCH_LINE = "The team will call you to confirm when someone can come out.";

/**
 * 2026-11-04: the pattern only knew the four phrasings it was found with,
 * and half of the ways the model actually makes this promise went straight
 * through to the caller:
 *
 *   "a tech is en route to you"          "we're on our way"
 *   "the plumber is coming now"          "they're heading out now"
 *   "someone should be there shortly"    "I have someone headed your way"
 *   "someone will be out to you within 90 minutes"
 *
 * Two of those are near-misses of rules that were already here, which is
 * what makes the shape worth naming: "on the way" listed the|their|his|her
 * but not our|your, and the heading branch accepted "is|are heading" but
 * not the contraction in "they're heading". Every promise below is a visit
 * nobody has agreed to, which is the one thing this guard exists to stop.
 *
 * Checked in both directions, because a guard that rewrites honest replies
 * is its own bug: the safe lines above, "the team will reach out to you",
 * "I'll have someone call you" and "can you get in the house" must all pass
 * through untouched, so each branch names its verb rather than matching
 * "out to you" or "in <time>" on their own.
 */
const DISPATCH_TECH = "(?:tech|technician|plumber|crew|team|guy)";
/**
 * 2026-11-05, caught on a real-model QA run of the servicearea category. A
 * caller rang from Portland, Oregon, and heard:
 *
 *   "The team will call you to confirm when someone can come out.
 *    I'd recommend calling a local plumber there."
 *
 * Self-contradictory, and the first half was this guard's own doing. The
 * model had correctly said it could NOT come out that far, and the rule
 * widened on 2026-11-04 matched "come out to you" inside the refusal and
 * replaced it with a promise. That is worse than the bug the widening
 * fixed: turning a correct no into a false yes.
 *
 * So a sentence that says it cannot happen is not a claim that it will.
 * Same shape as CHANGE_HEDGE, and applied per sentence like every other
 * rule here, so "we can't come out to you" is left alone while "someone
 * will be out to you within 90 minutes" is still caught.
 */
const DISPATCH_HEDGE =
  /\b(can'?t|cannot|can not|unable|not able|won'?t|will not|don'?t|do not|aren'?t|are not|isn'?t|is not|no one|nobody|outside (?:our|the))\b/i;

const DISPATCH_CLAIM = new RegExp(
  [
    `\\bdispatch(?:ing|ed)?\\s+(?:someone|somebody|them|a\\s+${DISPATCH_TECH}|our\\s+${DISPATCH_TECH})`,
    "\\bon\\s+(?:the|their|his|her|our|your|my)\\s+way\\b",
    "\\ben\\s?route\\b",
    "\\bhead(?:ing|ed)\\s+(?:out|over|your\\s+way|to\\s+you|that\\s+way)\\b",
    "\\b(?:be|get|arrive|arriving)\\s+(?:there\\s+|out\\s+there\\s+|to\\s+you\\s+)?(?:within|in)\\s+(?:about\\s+|around\\s+|under\\s+)?(?:\\d|an?\\b|one|two|half|the\\s+(?:hour|next|half))",
    `\\bsend(?:ing)?\\s+(?:someone|somebody|a\\s+${DISPATCH_TECH}|our\\s+${DISPATCH_TECH})\\s+(?:out|over|now|right|your|to)`,
    "\\b(?:be|come|get)\\s+out\\s+to\\s+you\\b",
    `\\bhave\\s+(?:someone|somebody|a\\s+${DISPATCH_TECH})\\s+(?:there|out|headed|heading|on)\\b`,
    "\\b(?:is|are|'s|'re)\\s+coming\\s+(?:now|right|out|over|to\\s+you)\\b",
    "\\b(?:should|will|'ll)\\s+be\\s+there\\s+(?:shortly|soon|within|in|by|around)\\b",
  ].join("|"),
  "i",
);
/**
 * Whether the visit or estimate costs anything is not published either way
 * (the business's own knowledge says never to claim it). 2026-10-26, the
 * client's test scripts on the production model: "It's not a free service",
 * said to someone asking about a remodel estimate, and on another run "the
 * estimate visit is typically done for free".
 */
export const SAFE_FEE_LINE = "The team will confirm any charge for the visit when they call.";
const VISIT_WORDS =
  /\b(estimates?|visits?|quotes?|consultations?|assessments?|diagnos\w*|trip|service call|come out|coming out)\b/i;
const FEE_WORDS = /\b(free|complimentary|charge|fee|no cost|costs? (?:nothing|about|around|\$))\b/i;
const IS_FREE = /\b(?:it'?s|it is|that'?s|that is|is|are)\s+(?:not\s+)?(?:a\s+)?free\b/i;
const FEE_HEDGE =
  /\b(confirm\w*|not sure|can'?t (?:say|tell)|don'?t know|(?:isn'?t|not) published|let you know|whether|asking|wondering)\b/i;
/**
 * Whether the technician calls before arriving is not in the business's
 * knowledge. 2026-10-26, the client's test scripts, every run on the
 * production model: "The technician typically calls before arriving",
 * said to a caller relying on it to unlock her gate.
 */
/**
 * 2026-11-05, real-model QA. Three scenarios in one round caught Grace
 * inventing a pricing policy nobody published:
 *
 *   round5-01: "No holiday surcharge, we charge the same flat rate year-round."
 *   round4-08: a referral discount, answered as fact.
 *   honesty-12: a promotion, answered as fact.
 *
 * The fee rule above deliberately steps around discounts (its own
 * `off|coupon|discount` exclusion), so surcharges, discounts, promotions
 * and referral credits had no guard at all. Saying there is NO surcharge is
 * as much an invention as saying there is one, and it is the kind a caller
 * only discovers is wrong when the invoice arrives.
 */
export const SAFE_PRICE_POLICY_LINE =
  "I don't have that here, but the team will go over the price when they call.";
const PRICE_POLICY_WORDS =
  /\b(surcharges?|discounts?|promotions?|promos?|coupons?|vouchers?|specials?|deals?|referral (?:credit|bonus|discount|program)|flat rate|(?:extra|additional|added|hidden) (?:charge|fee|cost)s?|(?:weekend|holiday|after-?hours|overtime|emergency) (?:rate|fee|charge|pricing)s?)\b/i;
/**
 * 2026-11-05, after reading the live site: the asymmetry matters.
 *
 * The business DOES publish that "after-hours rates do apply for nights,
 * weekends, and holidays", so warning a caller about a charge is both true
 * and the safe direction to be wrong in: nobody is upset by a surcharge
 * that does not materialise. The first version of this rule blocked that
 * sentence too, which replaced a published fact with a deflection.
 *
 * Denying a charge is the dangerous half, and it is what was actually
 * caught on QA ("No holiday surcharge, we charge the same flat rate
 * year-round"). So is promising money off: a discount, promo or referral
 * credit nobody authorised. Those two stay blocked; a plain statement that
 * a surcharge applies now goes through.
 */
const PRICE_POLICY_DENIAL =
  /\b(no|not|aren'?t|isn'?t|won'?t|never|without|same (?:flat )?rate|free)\b/i;
/** Money off: a thing Grace can never promise, whoever asks. */
const PRICE_POLICY_BENEFIT =
  /\b(discounts?|promotions?|promos?|coupons?|vouchers?|specials?|deals?|referral (?:credit|bonus|discount|program))\b/i;

/** An assertion that such a thing does or does not exist. */
const PRICE_POLICY_CLAIM =
  /\b(?:we|they|there|it)\s*(?:'?s|'?re|is|are|do|does|don'?t|doesn'?t|have|has|offer|run|charge|apply|aren'?t|isn'?t)\b|\b(?:no|not? any|yes|same)\b/i;
const PRICE_POLICY_HEDGE =
  /\b(don'?t (?:have|know)|do not have|not sure|can'?t say|cannot say|couldn'?t say|i'?d have to check|the team (?:will|can|would)|they (?:can|will) (?:go over|tell|confirm)|note|noted|ask|asking|confirm\w*|check with)\b/i;

/**
 * 2026-11-06, answered by the client. These two were unpublished until
 * Larry Bellach replied to Amar, and the rules above were built for the
 * world where nobody knew the answer. They are known now, so the guard
 * stops standing in front of them.
 *
 * The asymmetry from the surcharge rule applies again, and matters more
 * here. The real answer has two halves: an estimate IS free if the caller
 * already knows what they want, and a diagnostic visit IS charged, one
 * hour at $399, when they do not know what they want or a technician has to
 * get tools out. Naming the charge is the safe direction, so it goes
 * through on its own. Saying "free" does NOT, unless the sentence carries
 * the condition with it, because a caller who needs diagnosing would hear
 * "the estimate is free" and then be billed $399. That is the exact dispute
 * this family of rules exists to prevent, and it was nearly caused by the
 * guard rather than prevented by it.
 */
const DIAGNOSTIC_CHARGE =
  /\b(?:diagnostics?|diagnosing|troubleshoot\w*)\b[^.?!]{0,40}\b(?:charge|fee|cost|hour|\$)|\b(?:charge|fee|cost)\b[^.?!]{0,40}\b(?:diagnostics?|diagnosing|troubleshoot\w*)\b/i;
/** "Free" is only allowed to leave with the condition that makes it true. */
const FREE_WITH_ITS_CONDITION =
  /\b(?:if|when|unless|as long as|provided|once)\b[^.?!]{0,70}\bfree\b|\bfree\b[^.?!]{0,70}\b(?:if|when|unless|as long as|but if|though if)\b/i;

/**
 * 2026-11-06, real-model QA (round4-05). A developer rang about rough-in
 * plumbing for six new townhomes and Grace answered "We do handle
 * commercial work, including new construction."
 *
 * Commercial work IS in the approved knowledge (offices, retail,
 * restaurants, apartments). Ground-up new construction is NOT, at any
 * scale, and neither is multi-unit rough-in. So half that sentence was
 * true and the half the caller actually asked about was invented.
 *
 * This is the costliest direction to guess in on the whole line. A
 * six-townhome contract is the largest lead the business is likely to get
 * from this phone number, and either answer invented is bad: "yes we do"
 * commits them to work they may not take, and "no we don't" throws the
 * lead away on Grace's say-so. The caller is told the team will go over it,
 * which is true, and the detail still reaches the team in the notes.
 *
 * Deliberately narrow to new builds. "We do commercial work" stays
 * allowed, because that one is published.
 */
export const SAFE_NEW_BUILD_LINE =
  "That's a bigger job than I can speak to from here, but I'll get it to the team and they'll go over it with you.";
const NEW_BUILD_SCOPE_CLAIM =
  /\b(?:we|they)\s+(?:do|don'?t|do not|handle|take on|cover|work on|take)\b[^.?!]{0,34}\b(?:new[-\s]construction|new builds?|ground[-\s]up)\b|\b(?:new[-\s]construction|new builds?)\b[^.?!]{0,26}\b(?:is|isn'?t|are|aren'?t|would be)\b[^.?!]{0,26}\b(?:something we|outside|within|what we|our)\b|\bincluding new[-\s]construction\b/i;
/** Asking about it, or passing it on, is not claiming it. */
const NEW_BUILD_HEDGE =
  /\b(?:team will|team can|pass (?:this|that|it)|let the team|not sure|can'?t say|don'?t know|go over|they'?ll confirm|i'?ll note|check with)\b/i;

/**
 * 2026-11-06, found by reading a passing-looking transcript rather than a
 * failing check. A caller whose leak was repaired a month ago asked if it
 * was under warranty, and Grace answered "this should be covered", then
 * "a repair done a month ago should definitely be covered".
 *
 * Larry Bellach's answer was "one year on everything we supply and
 * install". That caller had a REPAIR. Whether a repair with no parts
 * supplied falls under "supply and install" is not something anyone has
 * answered, so this is a coverage promise nobody authorised, made to
 * someone already unhappy about paying twice.
 *
 * Grace may say the warranty exists and that it runs a year. Deciding
 * whether one particular job falls under it is the manager's, which is the
 * same rule that already applies to an expired one.
 */
export const SAFE_COVERAGE_LINE =
  "There's a one-year warranty on our work, and the team will confirm how it applies here.";
const COVERAGE_CLAIM =
  /\b(?:should|will|would|is|are|that'?s|this'?s|it'?s)\s+(?:definitely\s+|certainly\s+|absolutely\s+)?(?:be\s+)?covered\b|\bwe'?ll cover (?:it|that|this)\b|\bthat (?:falls|comes) under (?:the )?warranty\b|\bunder warranty,? so\b/i;
/** Saying the warranty EXISTS, or that the team will check, is not a promise. */
const COVERAGE_HEDGE =
  /\b(?:team will|team can|manager|confirm\w*|check|look at|not sure|can'?t say|don'?t know|case by case|they'?ll (?:let you know|decide|work out))\b/i;

export const SAFE_CALL_AHEAD_LINE = "I'll note that you'd like a call before they arrive.";
/**
 * 2026-11-04: six of the eight ways of making this promise went through.
 * The subject list had no "you" or "someone", the only verb was "call", and
 * a contraction broke the subject match outright, because `he` then needed
 * whitespace before the verb and "He'll call" has an apostrophe there:
 *
 *   "He'll call before he comes."      "You'll get a call before they arrive."
 *   "Our tech always rings ahead."     "Someone will call you first."
 *   "They text you before arriving."
 *   "The plumber will give you a call when he's on his way."
 *
 * The last one is a near-miss of a rule already here: "on the way" listed
 * their|the but not his|her. The original finding was a caller relying on
 * this to unlock her gate, so the cost of being wrong is someone standing
 * outside a locked gate, not just an inaccurate sentence.
 *
 * The qualifier is what keeps this off honest lines. "The team will call you
 * to confirm" and "the team will call you back" carry no before/ahead/first,
 * so they are not touched.
 */
const CALL_AHEAD_SUBJECT =
  "(?:technicians?|techs?|plumbers?|they|he|she|someone|somebody|the team|our team|we|you)";
const CALL_AHEAD_VERB =
  "(?:calls?|call|ring|rings|text|texts|reach out|let you know|give you a (?:call|ring|heads up)|get a (?:call|ring|text))";
const CALL_AHEAD_WHEN =
  "(?:before|ahead|prior|first|en\\s?route|on (?:the|their|his|her) way|when (?:they|he|she)(?:'?re|'?s| is| are)? (?:close|nearby|on (?:the|their|his|her) way))";
const CALL_AHEAD_CLAIM = new RegExp(
  `\\b${CALL_AHEAD_SUBJECT}\\b(?:'?ll|'?s|'?re)?(?:\\s+(?:will|would|usually|typically|always|normally|generally|do|does|should|can|might))*\\s+${CALL_AHEAD_VERB}\\b[^.?!]{0,25}\\b${CALL_AHEAD_WHEN}\\b`,
  "i",
);
const CALL_AHEAD_HEDGE =
  /\b(note|ask|request|make sure|let them know|can'?t|cannot|not sure|don'?t know)\b/i;
/**
 * What a price covers (labor, parts, the fixture) is not in the business's
 * knowledge. 2026-10-26, the client's test scripts on the production model:
 * "does that price include the toilet itself?" got "labor only" on one run
 * and "includes the installation, the toilet is separate" on another.
 */
export const SAFE_SCOPE_LINE = "The technician's quote will spell out exactly what's included.";
const PRICE_SCOPE_CLAIM =
  /\b(?:price|quote|cost|rate)s?\b[^.?!;]{0,25}\b(?:covers?|includes?|including)\b|\b(?:purchased?|bought|buy|paid for)\b[^.?!;]{0,20}\bseparately\b|\b(?:toilet|unit|fixture|parts?|materials?|equipment)(?: itself)? (?:is|are|would be) (?:typically |usually |generally )?(?:separate|extra|not included)\b/i;
const PRICE_SCOPE_HEDGE = /\b(whether|note|ask|not sure|don'?t know|can'?t say|confirm)\b/i;
export const SAFE_CHANGE_LINE =
  "I can't change appointments from here, but I'll pass this to the team and they'll confirm it with you.";

/** "The team will call you to set up a time", "They'll call you back": see prefersText. */
const TEAM_WILL_CALL =
  /\b(the team|our team|they|someone|a technician|we)(?: will|'ll) (?:give you a call(?: back)?|call you(?: back)?|call)\b/i;

const META_LEAK =
  /\b(per (the|my) (instructions?|prompt|rules?|guidelines?)|according to (the|my) (instructions?|prompt|guidelines?)|the (caller|customer) (has|had|already|just|is|said|wants|signed)|already said goodbye|ended the call|the call is over|system note|as an ai\b|my (system )?prompt|no further (response|action) (is )?(needed|required|necessary)|\b(this|that|my|the next|in this) turn\b|(i'?m |i am |i'?ve |i have )(flagg|mark)(ed|ing) (this|it|that)( as| now|\b)|\bretrying\b|\b(i'?ll|i will|let me) retry\b|\bthe system (wants|needs|says|requires|rejected|flagged|won'?t|didn'?t|is asking)\b|(i'?m|i am) (checking|looking into|looking up|pulling up) (that|this|it|your)\b|\blet me (check|look up|pull up|look into|see) (that|this|it|your|on that|how)\b|\b(saving|submitting|sending) (your|the|this) (request|info|information|details|lead)( now)?\b)/i;

/**
 * QA 2026-10-13, on Claude Haiku 5.5 with thinking off: the model wrote its
 * reasoning as the reply ("Caller is speaking Spanish. Need to call
 * escalateEmergency since they describe a problem..."). Nothing Grace says to
 * a caller ever names a tool, talks about "the caller" in the third person, or
 * starts with "Need to", so such sentences are dropped.
 */
const REASONING_LEAK =
  /\b(the|in the|request|call|my) notes\b|\b(refused|rejected)\b|\b(complaint|new|the|a|this) lead\b|\bcreate (the|a) (lead|record|request)\b|\b(i'?ll|i will|let me|i need to) save\b|\b(couldn'?t|could not|can'?t|cannot) (update|save|add|submit|create)\b|\b(on file|in (the|our) system|the record)\b|\b(escalateEmergency|createCustomer|createLead|updateLead|searchCustomer|transferToHuman|getServiceAreas|getBusinessHours|lookupPreviousCalls)\b|\bcaller\b|^\s*(i )?need to (call|ask|check|use|run|respond|reply|confirm|get)\b|^\s*(speak|respond|reply) (in|with)\b/i;

/** The acknowledgment a reply opens with, fused or standing alone ("Got it, Harold."). */
const ACK_OPENER = /^(got it|gotcha|okay|ok|alright|all right|perfect|great|sure|understood)\b/i;
/** How many of the recent replies may open with the same acknowledgment before it is dropped. */
const ACK_OPENER_LIMIT = 2;

/** A sentence that is only an acknowledgment, with no information in it. */
const PURE_ACK =
  /^(got it|okay|ok|alright|all right|right|sure|perfect|great|gotcha|thanks|thank you|no problem|mm-?hm|understood|thanks for (telling|letting) me( know)?)[.!]?$/i;
/** "today"/"tonight" in Grace's own statements; the client asked that she never say them (v49). */
const OWN_TODAY = /\b(today|tonight)\b/gi;

const TIME_WORD =
  /\b(today|tonight|this (morning|afternoon|evening)|same[- ]day|tomorrow|next (day|morning)|within (the )?(next )?(\d+|an?|one|two|three|few) ?(hours?|minutes?|mins?)|in (about |around )?(an|\d+) (hour|hours|minutes)|by (tonight|tomorrow|end of (the )?day))\b/i;

/** Statements that book or agree a slot, whatever the subject. */
const HARD_PROMISE =
  /\b(got|have|put) you (down|booked|scheduled|set up|on the schedule)\b|\b(booked|scheduled|locked in) for\b|\block(?:ed)? in (a|the) time\b|\b(works|is fine|sounds good|is good|will work)\b/i;

/** A team member acting at a time, or a modal about the team. */
const SOFT_PROMISE = /('ll|\bwill\b|\bcan\b|\bcould\b|\bgoing to\b|\bgonna\b|\bshould\b)/i;

const HEDGE =
  /\b(can'?t|cannot|unable|not able|no promise|won'?t|note|noted|prefer|preference|depends|if possible|may|might|possibly|possible|sometimes|usually|typically|hopefully|try|whether|open|24\/7)\b/i;

/**
 * 2026-11-04: Grace cannot touch an appointment at all, but the pattern only
 * covered a claim already in the past and only with a pronoun in front of
 * it. The ways she most naturally says it went through:
 *
 *   "I'll cancel that for you now."     "Consider it cancelled."
 *   "I went ahead and cancelled it."    "I removed you from the schedule."
 *   "Your visit is off the schedule."   "I updated your appointment to Thursday."
 *
 * A caller who believes their visit is cancelled when it is not either waits
 * for a truck that never comes or gets one they cancelled. The future tense
 * matters as much as the past here: "I'll cancel that" is a promise Grace has
 * no mechanism to keep, which is the same defect as a transfer she cannot
 * make.
 */
const CHANGE_VERB =
  "(?:cancell?(?:ed|ing)?|resched(?:ule|uled|uling)?|mov(?:e|ed|ing)|chang(?:e|ed|ing)|push(?:ed)?\\s+back|bump(?:ed)?|updat(?:e|ed)|remov(?:e|ed))";
const CHANGE_CLAIM = new RegExp(
  [
    // Deliberately no bare "is" or "been" in this lead-in. "Same-day service
    // is sometimes available when booked before 2pm" is honest policy, and a
    // bare "is" put it within reach of "booked" 30 characters later.
    "\\b(?:i'?ve|i have|it'?s|that'?s|you'?re|your|has been|have been|is now|are now)\\b[^.?!]{0,30}\\b(?:cancell?ed|rescheduled|moved|booked|pushed back|bumped)\\b",
    `\\b(?:i|i'?ll|i will|let me|i'?m going to|i can|i just)\\b[^.?!]{0,25}\\b${CHANGE_VERB}\\b[^.?!]{0,20}\\b(?:it|that|this|your|the)\\b(?:\\s+(?:appointment|visit|booking|slot|time|schedule|one))?`,
    // 2026-11-05, real-model QA: "I can help get that rescheduled." The
    // object comes BEFORE the verb here, which the lead-in branch above
    // (verb then object) cannot see, and "I can help" reads as a promise
    // Grace has no way to keep.
    `\\b(?:let me|i can|i'?ll|i will|we can|i'?m able to)\\s+(?:help\\s+)?(?:get|have)\\s+(?:that|it|this|your\\s+\\w+)\\s+${CHANGE_VERB}\\b`,
    "\\b(?:cancell?ed|rescheduled|moved)\\s+(?:it\\s+|that\\s+)?(?:for you|your appointment|your visit)\\b",
    "\\bconsider (?:it|that|this) (?:cancell?ed|rescheduled|moved|done|handled)\\b",
    "\\b(?:off|taken off|removed from|remove you from|removed you from)\\s+(?:the\\s+)?(?:schedule|books|calendar)\\b",
  ].join("|"),
  "i",
);

/** A guess at what causes or links problems, which cannot be known from a phone call. */
const CAUSE_CLAIM =
  /\b(could|might|may|probably|likely|usually|possibly|sounds like|typically)\b[^.?!]{0,60}\b(connected|related|linked|ties? to|tied to|caused by|due to|the same (issue|problem|clog|drain|line|cause|leak))\b|\b(usually|probably|typically|often) (a|the) (worn|faulty|clogged|bad|broken|loose|cracked)\b|\b(usually|probably|typically) (ties|points) to\b|\b(?:reasons?|causes?|things|issues),? (?:like|such as)\b[^.?!]{0,40}\b(?:faulty|worn|failed|failing|bad|broken|loose|cracked|clogged|corroded|leaky|damaged|stuck|age|aging|old)\b|\b(?:caused by|happen for|come from|due to) (?:a few|several|many|various|a number of|some)(?: different)? (?:things|issues|reasons|causes|problems)\b(?![^.?!]*\btechnician)/i;

/**
 * Noting a request is not making the change, and saying so is exactly what
 * Grace is supposed to do: "I'll note that you want to move it, and the team
 * will confirm" has to survive the widened claim pattern above untouched.
 */
const CHANGE_HEDGE =
  /\b(can'?t|cannot|unable|not able|won'?t|note|noted|pass (?:this|that|it) (?:on |along )?to|let the team know|the team will)\b/i;

const STREET_READBACK =
  /\b\d{1,6}\s+(?:[A-Za-z0-9'.]+\s+){0,3}(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|way|place|pl|court|ct|circle|cir|terrace|ter|parkway|pkwy|highway|hwy)\b/i;

/**
 * 2026-10-22 tester call: "It took the address and it repeated the address
 * very fastly and again in a garbling manner."
 *
 * Both symptoms are one miss. STREET_READBACK needs the street TYPE word in
 * the same breath as the number, and a readback often does not have it --
 * "So that's 4512 Maple?", or the sentence arrives split across two speech
 * segments with the number in one and "Street" in the other. With no match,
 * the segment loses both of its readback protections at once: the [slowly]
 * cue (so it is spoken at whatever rate the mood cue set, up to 0.97 against
 * the readback's 0.84) and hyphenation (so "4512" is read "forty-five
 * twelve" instead of "4-5-1-2"). Fast, and garbled.
 *
 * Guessing harder at the text is the wrong fix: the turn already KNOWS the
 * house number the caller gave, from the same call notes the model is shown.
 * Given it, a segment containing those digits is a readback whatever else is
 * in the segment.
 */
function mentionsHouseNumber(sentence: string, houseNumber: string): boolean {
  if (houseNumber.length < 3) {
    return false;
  }
  return sentence.replace(/[\s-]/g, "").includes(houseNumber);
}
const DIGIT_READBACK = /\b(?:\d[\s-]){4,}\d\b|\b\d{5}\b|\b\d{3}[-. ]\d{3}[-. ]\d{4}\b/;

/**
 * Client feedback: ElevenLabs reads "14101" as "fourteen" + "oh one oh one"
 * with an awkward split, not digit-by-digit. Hyphenating forces TTS to read
 * each digit separately, like a real receptionist would. Zeros become "oh"
 * ("6-2-oh-4") because ElevenLabs garbles an isolated "0" into something
 * that sounds like a different letter (client reported "6204" heard as "62L4").
 * Only applied inside the readback path (STREET_READBACK matched), never to
 * bare numbers in normal speech.
 */
const spellDigits = (digits: string): string =>
  digits
    .split("")
    .map((d) => (d === "0" ? "oh" : d))
    .join("-");

function hyphenateHouseNumber(sentence: string, houseNumber: string | null): string {
  const bySuffix = sentence.replace(
    /\b(\d{3,6})\b(?=\s+(?:[A-Za-z0-9'.]+\s+){0,3}(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|way|place|pl|court|ct|circle|cir|terrace|ter|parkway|pkwy|highway|hwy)\b)/gi,
    (_, digits: string) => spellDigits(digits),
  );
  // The street type is often not in the same sentence as the number ("So
  // that's 4512 Maple?") -- see mentionsHouseNumber. The number the caller
  // actually gave is spelled out wherever it appears, which is the half of
  // the garbled-readback fix that the pattern above cannot reach.
  if (!houseNumber || houseNumber.length < 3) {
    return bySuffix;
  }
  return bySuffix.replace(new RegExp(`\\b${houseNumber}\\b`, "g"), spellDigits(houseNumber));
}

export type GuardAction =
  | "stock_opener"
  | "meta_leak"
  | "question_after_safety_line"
  | "call_promised_to_texter"
  | "timing_promise"
  | "change_claim"
  | "cause_claim"
  | "dispatch_claim"
  | "fee_claim"
  | "call_ahead_claim"
  | "scope_claim"
  | "slow_readback"
  | "repeated_statement"
  | "word_limit"
  | "wrong_name"
  | "wrong_spelling"
  | "wrong_phone_readback"
  | "second_question";

/**
 * 2026-10-23 client call: the callback number read back as
 * "8-7-2-2-7-8-4-9-9", one digit short, and the caller said yes to it. Another
 * call read it with the "+1" the prompt says to leave out. The note gives the
 * model the exact digits; it still slips. A number read back within two
 * digits of a number this call actually has is that number, so it is said
 * exactly. Anything further off is left alone: it is a different number.
 *
 * 2026-10-30, Prateek's call: "2-oh-2-oh-6-7-7-1-4-8-2-2", twelve digits, was
 * longer than any run looked at, so it was read out as it was. Two extra
 * digits are two edits like any other.
 */
// 2026-10-27 tester call: "+7207832385" was read out as "plus 7-2-oh-...". A
// "+" or "plus" without the 1 goes with the number too.
const PHONE_RUN = /(?:(?:\+|\bplus\s+)\s?(?:1[\s.-]*)?)?(?:\d[\s.()-]{0,2}){6,11}\d/gi;
const PHONE_READBACK_MAX_EDITS = 2;

function withTheRealNumber(sentence: string, knownPhones: readonly string[]): string {
  if (knownPhones.length === 0) {
    return sentence;
  }
  const aboutTheCallback = CALLBACK_CONTEXT.test(sentence);
  const fix = (run: string, digitsOf: (run: string) => string): string => {
    let digits = digitsOf(run);
    if (digits.length === 11 && digits.startsWith("1")) {
      digits = digits.slice(1);
    }
    if (digits.length < 8 || digits.length > 10 + PHONE_READBACK_MAX_EDITS) {
      return run;
    }
    const nearest = knownPhones
      .map((phone) => ({ phone, edits: editDistance(digits, phone) }))
      .sort((a, b) => a.edits - b.edits)[0]!;
    if (nearest.edits <= PHONE_READBACK_MAX_EDITS) {
      return spellDigits(nearest.phone);
    }
    // 2026-10-23, live call: offered as "the number you called from", a number
    // this call never had (the prompt's own example) was read to the caller.
    // Asked about as their callback number, it can only be one of theirs; the
    // one they said last wins over caller ID.
    return aboutTheCallback ? spellDigits(knownPhones[knownPhones.length - 1]!) : run;
  };
  return sentence
    .replace(PHONE_RUN, (run) => fix(run, (r) => r.replace(/\D/g, "")))
    .replace(SPOKEN_PHONE_RUN, (run) =>
      fix(run, (r) =>
        r
          .toLowerCase()
          .split(/[^a-z]+/)
          .filter(Boolean)
          .map((word) => SPOKEN_DIGIT[word] ?? "")
          .join(""),
      ),
    );
}

/** A number said in words, "two-zero-six-five-five-five...". */
const SPOKEN_PHONE_RUN =
  /\b(?:(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)[\s,-]+){7,11}(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)\b/gi;
const SPOKEN_DIGIT: Record<string, string> = {
  zero: "0",
  oh: "0",
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
/** The sentence is about where to reach the caller. */
const CALLBACK_CONTEXT = /\b(number|reach you|call you|callback|call back)\b/i;

function editDistance(a: string, b: string): number {
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
  return previous[b.length]!;
}

/**
 * 2026-10-22 tester call: "Called as a returning customer, also gave name in
 * starting, but still near the end of the call it changed the name completely
 * to something else."
 *
 * Several people share a phone number, so the prompt already forbids ever
 * saying a stored name ("# RETURNING CALLERS": never say a stored name, treat
 * every caller as new). Late in a long call that rule loses to whatever name
 * is nearest in context -- the matched record's, or a plain mishearing -- and
 * being called by a stranger's name at the close undoes the whole call.
 *
 * Nothing invents or substitutes a name here: a name Grace was NOT given is
 * simply not spoken. Addressing someone by no name reads as normal; by the
 * wrong one does not.
 *
 * Only the two forms Grace actually uses are touched, both of them vocative:
 * a trailing ", Dana" at the end of a sentence, and a greeting or thanks
 * followed by a name. A name used any other way (a street called Dana Avenue,
 * a technician the caller asked for) is left exactly as written.
 */
const VOCATIVE_TRAILING = /,\s+([A-Z][a-z'’-]{1,20})(?=\s*[.!?]|\s*$)/g;
// Spelled with explicit case rather than the `i` flag: `i` would also make
// the NAME group match a lowercase word, and "thanks for calling" would read
// "for" as the name.
const VOCATIVE_AFTER_OPENER =
  /\b([Tt]hanks|[Tt]hank you|[Hh]i|[Hh]ello|[Hh]ey|[Oo]kay|[Oo]k|[Aa]lright|[Aa]ll right|[Gg]ot it|[Ss]ure|[Pp]erfect|[Bb]ye|[Gg]oodbye|[Tt]ake care)\s+([A-Z][a-z'’-]{1,20})\b/g;

/** Capitalised words that follow a vocative pattern but are never the caller's name. */
const NOT_A_VOCATIVE_NAME = new Set([
  "i",
  "im",
  "ill",
  "ive",
  "and",
  "but",
  "so",
  "the",
  "we",
  "you",
  "your",
  "it",
  "its",
  "is",
  "that",
  "this",
  "there",
  "then",
  "yes",
  "no",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "grace",
  // Words that can follow a comma, capitalised, without being anyone's name.
  "thanks",
  "thank",
  "sorry",
  "please",
  "bye",
  "goodbye",
  "okay",
  "ok",
  "sure",
  "right",
  "perfect",
  "great",
  "absolutely",
  "alright",
  "got",
]);

/**
 * A spelled-out run in Grace's own speech: "S-I-O-B-H-A-N". Three letters
 * minimum, so an initial ("J. R.") and ordinary hyphenated words
 * ("mother-in-law", "T-shirt") are not candidates.
 *
 * HYPHENS ONLY, deliberately. A space-separated alternative was tried first
 * and its own test caught it eating a letter out of the preceding word:
 * "That's A-N-A" matched from the "s" of "That's" and came back as
 * "That'A-N-N-A". Hyphens are the form the call notes hand over and the
 * form the prompt asks for, and a mangled word is a worse failure than a
 * missed spelling.
 *
 * 2026-10-22, second tester: "there are few instances where the csr still
 * guesses big names - i tried with mexican, caucasian and black names."
 * Asked to spell a name it only has by ear, the model supplies the letters
 * of the nearest name it knows. The call notes now hand it the real letters,
 * and this is the backstop for when it spells something else anyway — the
 * same "prompt wording has a ceiling, put a guard in the code" rule the
 * rest of this file is built on.
 *
 * Nothing is invented: the replacement letters are the caller's own name, so
 * the worst case is Grace spelling the name she was actually given.
 */
const SPELLED_RUN = /\b[A-Za-z](?:-[A-Za-z]){2,}\b/g;

const lettersOf = (run: string): string => run.replace(/[^a-z]/gi, "").toLowerCase();

const sameName = (a: string, b: string): boolean => {
  const left = a.toLowerCase().replace(/[^a-z]/g, "");
  const right = b.toLowerCase().replace(/[^a-z]/g, "");
  return left.length > 0 && (left === right || editDistanceAtMostOne(left, right));
};

/**
 * Client feedback (previous vendor's call, Oct 7): the CSR answered three
 * price questions with the same sentence, "Pricing depends on the job and
 * will be discussed before any work begins", word for word, and the caller
 * heard a recording. A statement Grace already made in one of her last few
 * replies is dropped instead of said again. Questions are never dropped
 * (re-asking an unanswered ZIP once is legitimate), and nor are short
 * sentences, where repeats are natural ("Okay.", "Is that right?").
 */
const REPEAT_MIN_WORDS = 5;

/** Every digit in a sentence, "oh" read as 0: "1-2-oh-5" and "1205" are the same. */
function digitsIn(sentence: string): string {
  return sentence.replace(/\boh\b/gi, "0").replace(/\D/g, "");
}
const REPEAT_SIMILARITY = 0.8;

function normalizedWords(sentence: string): string[] {
  return words(sentence)
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function similarity(a: readonly string[], b: readonly string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  let shared = 0;
  for (const word of setA) {
    if (setB.has(word)) {
      shared += 1;
    }
  }
  return shared / Math.max(setA.size, setB.size, 1);
}

function splitSentences(segment: string): string[] {
  return segment.match(/[^.!?]+(?:[.!?]+|$)\s*/g) ?? [segment];
}

/** Strips leading [cue] tags so the classifiers read only the words. */
function words(sentence: string): string {
  return sentence.replace(/\[[^\]]*\]/g, " ").trim();
}

function isQuestion(sentence: string): boolean {
  return /\?\s*$/.test(words(sentence));
}

/**
 * Call-centre phrasing the previous vendor's CSR used on every call ("May I
 * have your full name?"), which the prompt bans and the model still produces
 * now and then at low effort. Rewritten in place rather than dropped, since
 * the question itself is needed.
 */
const STIFF_PHRASES: ReadonlyArray<[RegExp, string]> = [
  [/\bMay I have\b/g, "Can I get"],
  [/\bmay I have\b/g, "can I get"],
  [/\bMay I get\b/g, "Can I get"],
  [/\bmay I get\b/g, "can I get"],
];

function plainSpoken(sentence: string): string {
  return STIFF_PHRASES.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    sentence,
  );
}

/** A delivery cue voice-runtime acts on: one or two plain words ("slowly", "pause", "softly"). */
const DELIVERY_CUE = /^\s*[a-z]+(?:[ -][a-z]+)?\s*$/i;

/** Sentences past this word count are dropped (complete sentences only). */
const SOFT_WORD_LIMIT = 35;

/**
 * 2026-11-05, caught on a real-model QA run: "Absolutely, we can help with
 * that." The platform prompt already bans this opener and the suite has a
 * universal invariant against it, but nothing enforced it, so it came out
 * on the model's own choice of words.
 *
 * It is the vendor-call-centre register the client objected to by name.
 * Grace answers; she does not perform enthusiasm first.
 *
 * Only ever stripped from the FRONT of a sentence and only when real words
 * follow, so a reply that is nothing but "Absolutely." keeps its one word
 * rather than becoming silence, and the same word mid-sentence ("that's
 * absolutely fine") is untouched.
 */
const STOCK_OPENER =
  /^(?:absolutely|certainly|definitely|of course|sure thing|great question|good question|happy to help|i'?d be happy to help)\b[,!.]*\s*/i;

/** True when the sentence is the opener and nothing else ("Great question."). */
function isOnlyAStockOpener(sentence: string): boolean {
  return STOCK_OPENER.test(sentence) && !/[a-z]{2}/i.test(sentence.replace(STOCK_OPENER, ""));
}

function withoutStockOpener(sentence: string): string {
  const trimmed = sentence.replace(STOCK_OPENER, "");
  if (trimmed === sentence || !/[a-z]{2}/i.test(trimmed)) {
    return sentence;
  }
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export class OutputGuard {
  private readonly used = new Set<string>();
  private readonly recentStatements: string[][];
  /**
   * Acknowledgment words that have already opened two of the last three
   * replies. See the PURE_ACK drop below.
   */
  private readonly spentAcks: ReadonlySet<string>;
  /** The digits each of recentStatements carries, in the same order; see repeatsRecentStatement. */
  private readonly recentStatementDigits: string[];
  private readonly questionsLastTurn: string[][];
  private lastSentenceKey = "";
  private spokeAlready: boolean;
  private readonly questionsThisTurn: string[][];
  private wordsSoFar = 0;
  readonly actions: GuardAction[] = [];

  /** `recentAgentReplies`: Grace's last few replies this call, oldest first. */
  /** `alreadySpokeThisTurn`: an earlier pass of this same turn already said something. */
  /** `callerName`: the first name the caller gave THIS call, when one is known — see NOT_A_VOCATIVE_NAME. */
  constructor(
    recentAgentReplies: readonly string[] = [],
    alreadySpokeThisTurn = false,
    alreadySaidThisTurn = "",
    private readonly callerName: string | null = null,
    private readonly houseNumber: string | null = null,
    /**
     * The caller asked Grace to say it again. The repeat suppression below
     * exists because a CSR who says the same sentence twice unprompted sounds
     * like a recording (client feedback, Oct 7) -- but when the repeat is
     * what was asked for, dropping it is dead air on top of a caller who
     * already could not hear. See isRepeatRequest.
     */
    private readonly repeatRequested = false,
    /** Every word of the name the caller gave, lowercase — see SPELLED_RUN. */
    private readonly nameWords: readonly string[] = [],
    /** This call's phone numbers, 10 digits each — see withTheRealNumber. */
    private readonly knownPhones: readonly string[] = [],
    /**
     * QA 2026-10-27, Yash's gas-leak scenario: after "Please leave the
     * building now and call the gas company from outside." the model added
     * "Can I get your name?". A caller who smells gas is asked nothing until
     * they are out; the gas-leak note already says so, and this enforces it.
     */
    private readonly noQuestions = false,
    /**
     * 2026-10-30, Prateek's call: asked for a text or email instead of a
     * call, he still heard "The team will call you to set up a time".
     */
    private readonly prefersText = false,
  ) {
    this.spokeAlready = alreadySpokeThisTurn;
    /**
     * 2026-11-05, caught on a real-model QA run: a 39-word reply got
     * through a 35-word limit. A turn can run more than one completion
     * pass (one before a tool call, one after), each pass builds its own
     * guard, and the word budget was starting from zero every time. Each
     * pass was under the limit; what the caller heard was the two glued
     * together.
     *
     * The budget belongs to the TURN, not the pass, so a later pass starts
     * from what the earlier one already spent. Length is latency on a
     * phone, which is the whole reason the limit exists.
     */
    this.wordsSoFar = alreadySaidThisTurn.trim()
      ? alreadySaidThisTurn.trim().split(/\s+/).filter(Boolean).length
      : 0;
    this.questionsThisTurn = splitSentences(alreadySaidThisTurn)
      .filter((sentence) => isQuestion(sentence))
      .map(normalizedWords);
    const statements = recentAgentReplies
      .flatMap((reply) => splitSentences(reply))
      .filter((sentence) => !isQuestion(sentence))
      .filter((sentence) => normalizedWords(sentence).length >= REPEAT_MIN_WORDS);
    this.recentStatements = statements.map(normalizedWords);
    /**
     * 2026-11-05, real-model QA (prateek1029-03 and round4-01): "Got it"
     * opened three replies in a row. The suite has carried an invariant
     * against this since the client named it as the tell on call 515d3539
     * ("got it" three times in one call), but PURE_ACK below only ever
     * deduped WITHIN a turn, so nothing stopped it across turns.
     *
     * Counted over the recent replies the guard is already given. A third
     * use is dropped rather than reworded: Grace has plenty of other
     * openers, and inventing a substitute risks saying something she was
     * never asked to say.
     */
    const ackCounts = new Map<string, number>();
    for (const reply of recentAgentReplies) {
      const opener = ACK_OPENER.exec(reply.trim())?.[1]?.toLowerCase();
      if (opener) {
        ackCounts.set(opener, (ackCounts.get(opener) ?? 0) + 1);
      }
    }
    this.spentAcks = new Set(
      [...ackCounts].filter(([, count]) => count >= ACK_OPENER_LIMIT).map(([word]) => word),
    );
    this.recentStatementDigits = statements.map(digitsIn);
    // On a second pass of the same turn the previous COMPLETED turn's reply is
    // one further back: the use case appends this turn's own pass-1 text.
    const previousReply = alreadySpokeThisTurn
      ? recentAgentReplies.at(-2)
      : recentAgentReplies.at(-1);
    this.questionsLastTurn = previousReply
      ? splitSentences(previousReply)
          .filter((sentence) => isQuestion(sentence))
          .map(normalizedWords)
      : [];
  }

  private repeatsRecentStatement(sentence: string): boolean {
    if (this.repeatRequested) {
      return false;
    }
    if (isQuestion(sentence)) {
      // 2026-10-14: "Is the water running right now...? Got it... Is the
      // water running right now...?" in one reply. A question already asked
      // earlier in this same turn is not asked again.
      //
      // The question from the turn before IS asked again. 2026-10-26,
      // Prateek's live call: asked for the address, he gave his last name,
      // and dropping the re-asked address question left "Thanks for that,
      // Trevor Michael." and silence until he said "what".
      const asked = normalizedWords(sentence);
      if (asked.length < 4) {
        return false;
      }
      // A read-back (digits or spelled letters) from the turn before is
      // still not read again unasked: the client's "it confirmed my address
      // more than three times" (2026-10-22). A reply left with nothing at all
      // is caught by the use case's onlyRepeated fallback, never silence.
      const isReadback =
        /\d[\s,-]*\d[\s,-]*\d/.test(sentence) || /\b[A-Za-z](?:-[A-Za-z]){2,}\b/.test(sentence);
      return (
        this.questionsThisTurn.some((earlier) => similarity(asked, earlier) >= REPEAT_SIMILARITY) ||
        (isReadback &&
          this.questionsLastTurn.some((earlier) => similarity(asked, earlier) >= REPEAT_SIMILARITY))
      );
    }
    const current = normalizedWords(sentence);
    if (current.length < REPEAT_MIN_WORDS) {
      return false;
    }
    // 2026-10-26, real-model QA (tester-08): a read-back of a CORRECTED
    // address is nearly word for word the first one, and was dropped,
    // leaving the caller only "Is that right?". Different digits are new.
    const digits = digitsIn(sentence);
    return this.recentStatements.some(
      (earlier, at) =>
        similarity(current, earlier) >= REPEAT_SIMILARITY &&
        this.recentStatementDigits[at] === digits,
    );
  }

  /**
   * Drops a vocative name that is not the one the caller gave. See
   * VOCATIVE_TRAILING's own comment: the name comes out, nothing is
   * substituted, and only the two vocative forms are touched.
   */
  private withoutAStrangersName(sentence: string): string {
    if (!this.callerName) {
      return sentence;
    }
    const isWrong = (spoken: string): boolean =>
      !NOT_A_VOCATIVE_NAME.has(spoken.toLowerCase().replace(/[^a-z]/g, "")) &&
      !sameName(spoken, this.callerName!);
    let changed = false;
    const cleaned = sentence
      .replace(VOCATIVE_TRAILING, (whole, spoken: string) => {
        if (!isWrong(spoken)) {
          return whole;
        }
        changed = true;
        return "";
      })
      .replace(VOCATIVE_AFTER_OPENER, (whole, opener: string, spoken: string) => {
        if (!isWrong(spoken)) {
          return whole;
        }
        changed = true;
        return opener;
      });
    if (!changed) {
      return sentence;
    }
    this.actions.push("wrong_name");
    return cleaned.replace(/\s{2,}/g, " ").replace(/\s+([.!?,])/g, "$1");
  }

  /**
   * Replaces a spelled-out run that does not match any name the caller gave
   * with that caller's own letters. See SPELLED_RUN.
   *
   * Matched by POSITION: the first run in a reply is the first name, the
   * second is the second. That is the order Grace says them in, and it is
   * the only mapping available once the letters themselves are wrong.
   */
  /** Inside a bracketed stage direction that began in an earlier segment of this turn. */
  private inStageDirection = false;

  /**
   * 2026-10-23, live call: Grace said "Wait patiently for them to complete
   * their thought." The model had written its own stage direction in square
   * brackets across two sentences ("[The caller is mid-sentence. Wait
   * patiently for them to complete their thought.]"). Sentences are checked
   * one at a time, so the first, which names "the caller", was dropped and
   * the second was spoken. Brackets are now handled as spans, across
   * sentences and across streamed segments: a short delivery cue such as
   * [slowly] or [pause] stays for voice-runtime, anything else in brackets is
   * dropped whole, and a closing bracket with no opening one drops what came
   * before it.
   */
  private withoutStageDirections(segment: string): string {
    let out = "";
    let rest = segment;
    if (this.inStageDirection) {
      const close = rest.indexOf("]");
      if (close === -1) {
        return "";
      }
      this.inStageDirection = false;
      rest = rest.slice(close + 1);
    } else {
      const firstClose = rest.indexOf("]");
      const firstOpen = rest.indexOf("[");
      if (firstClose !== -1 && (firstOpen === -1 || firstClose < firstOpen)) {
        this.actions.push("meta_leak");
        rest = rest.slice(firstClose + 1);
      }
    }
    for (;;) {
      const open = rest.indexOf("[");
      if (open === -1) {
        return out + rest;
      }
      out += rest.slice(0, open);
      const close = rest.indexOf("]", open);
      if (close === -1) {
        this.inStageDirection = true;
        this.actions.push("meta_leak");
        return out;
      }
      const inside = rest.slice(open + 1, close);
      if (DELIVERY_CUE.test(inside)) {
        out += rest.slice(open, close + 1);
      } else {
        this.actions.push("meta_leak");
      }
      rest = rest.slice(close + 1);
    }
  }

  private withTheRealSpelling(sentence: string): string {
    if (this.nameWords.length === 0) {
      return sentence;
    }
    let runIndex = -1;
    let changed = false;
    const cleaned = sentence.replace(SPELLED_RUN, (run: string, offset: number, whole: string) => {
      runIndex += 1;
      const spoken = lettersOf(run);
      // Already one of the caller's own names, in any position: leave it.
      if (this.nameWords.some((word) => sameName(spoken, word))) {
        return run;
      }
      // 2026-11-05, real-model QA (fullmix-10, a son calling for his
      // elderly mother): the caller was Nathaniel Prempeh and the person at
      // the house was Agnes Prempeh. Grace spelled the mother's name, this
      // rule saw letters that were not the CALLER's, and by position
      // rewrote them, so what went out was "Agnes, N-A-T-H-A-N-I-E-L".
      //
      // The word and its letters agreeing is the whole signal. A run that
      // spells the word right in front of it is a name said correctly, even
      // when that name belongs to someone else on the call; only a run that
      // CONTRADICTS the word beside it is the mis-spelling this exists to
      // catch ("Siobhan, J-O-H-N").
      const wordBefore = /([A-Za-z'\u2019-]+)[\s,:]*$/.exec(whole.slice(0, offset))?.[1] ?? "";
      if (wordBefore && sameName(spoken, wordBefore.toLowerCase())) {
        return run;
      }
      const expected = this.nameWords[runIndex];
      if (!expected) {
        return run;
      }
      changed = true;
      return expected.toUpperCase().split("").join("-");
    });
    if (!changed) {
      return sentence;
    }
    this.actions.push("wrong_spelling");
    return cleaned;
  }

  /** Returns the text to speak for this segment; an empty string means say nothing. */
  apply(rawSegment: string): string {
    const segment = this.withoutStageDirections(rawSegment);
    const out: string[] = [];
    let slow = false;
    const sentences = splitSentences(segment);
    // "Great question." and "Happy to help!" arrive as a sentence of their
    // own, so there is nothing after them to keep and stripping in place
    // would leave the opener behind. Such a sentence is dropped outright,
    // but only when the reply says something else too: a reply that is
    // nothing but "Absolutely." keeps its one word rather than becoming the
    // silence this guard exists to prevent elsewhere.
    const hasRealContent = sentences.some(
      (candidate) => words(candidate) !== "" && !isOnlyAStockOpener(candidate),
    );
    for (let sentence of sentences) {
      if (hasRealContent && isOnlyAStockOpener(sentence)) {
        this.actions.push("stock_opener");
        continue;
      }
      const plain = words(sentence);
      if (!plain) {
        out.push(sentence);
        continue;
      }
      const unstocked = withoutStockOpener(sentence);
      if (unstocked !== sentence) {
        this.actions.push("stock_opener");
        sentence = unstocked;
      }
      if (META_LEAK.test(plain) || REASONING_LEAK.test(plain)) {
        this.actions.push("meta_leak");
        continue;
      }
      if (this.noQuestions && isQuestion(sentence)) {
        this.actions.push("question_after_safety_line");
        continue;
      }
      if (this.prefersText && TEAM_WILL_CALL.test(sentence)) {
        this.actions.push("call_promised_to_texter");
        sentence = sentence.replace(TEAM_WILL_CALL, "$1 will reach out");
      }
      // Back-to-back identical sentences, however short ("Good luck with it.
      // Good luck with it."), QA 2026-10-13.
      const key = normalizedWords(sentence).join(" ");
      if (key && key === this.lastSentenceKey) {
        this.actions.push("repeated_statement");
        continue;
      }
      this.lastSentenceKey = key;
      // QA 2026-10-13: a pass before a tool call and the pass after it were
      // glued with a bare "Got it." in the middle, pushing replies past 35
      // words. An acknowledgment adds nothing once something was already said.
      if (
        PURE_ACK.test(plain) &&
        (this.spokeAlready || out.some((part) => words(part).length > 0))
      ) {
        continue;
      }
      // See spentAcks: the same opener has already carried two of the last
      // three replies. Only an acknowledgment-ONLY sentence is dropped, so
      // a fused "Got it, Harold." keeps the caller's name rather than being
      // rewritten into something Grace was never asked to say.
      if (
        PURE_ACK.test(plain) &&
        this.spentAcks.has((ACK_OPENER.exec(plain)?.[1] ?? "").toLowerCase())
      ) {
        this.actions.push("repeated_statement");
        continue;
      }
      if (this.repeatsRecentStatement(sentence)) {
        this.actions.push("repeated_statement");
        continue;
      }
      // Drop complete sentences past the soft word limit. Never cuts mid-
      // sentence, and the first sentence always gets through.
      const sentenceWordCount = plain.split(/\s+/).filter(Boolean).length;
      if (this.wordsSoFar > 0 && this.wordsSoFar + sentenceWordCount > SOFT_WORD_LIMIT) {
        this.actions.push("word_limit");
        continue;
      }
      if (!isQuestion(sentence) && TIME_WORD.test(plain)) {
        const hard = HARD_PROMISE.test(plain);
        const soft = SOFT_PROMISE.test(plain) && !HEDGE.test(plain);
        if (hard || soft) {
          this.actions.push("timing_promise");
          const replacement = /\b(works|is fine|sounds good|is good|will work)\b/i.test(plain)
            ? SAFE_PREFERENCE_LINE
            : SAFE_TIMING_LINE;
          if (!this.used.has(replacement)) {
            this.used.add(replacement);
            out.push(`${replacement} `);
          }
          continue;
        }
      }
      // Not a transfer ("I'm getting you connected to someone who can dispatch a tech"): that
      // connection is real, and replacing it mid-transfer would confuse the caller.
      if (
        !isQuestion(sentence) &&
        DISPATCH_CLAIM.test(plain) &&
        !DISPATCH_HEDGE.test(plain) &&
        !/\bconnect/i.test(plain)
      ) {
        this.actions.push("dispatch_claim");
        if (!this.used.has(SAFE_DISPATCH_LINE)) {
          this.used.add(SAFE_DISPATCH_LINE);
          out.push(`${SAFE_DISPATCH_LINE} `);
        }
        continue;
      }
      if (
        !isQuestion(sentence) &&
        ((VISIT_WORDS.test(plain) && FEE_WORDS.test(plain)) || IS_FREE.test(plain)) &&
        // See DIAGNOSTIC_CHARGE and FREE_WITH_ITS_CONDITION: both halves of
        // this are answered now, so the guard no longer blocks them.
        !DIAGNOSTIC_CHARGE.test(plain) &&
        !FREE_WITH_ITS_CONDITION.test(plain) &&
        !FEE_HEDGE.test(plain) &&
        !/\b(?:off|coupon|discount)\b/i.test(plain)
      ) {
        this.actions.push("fee_claim");
        if (!this.used.has(SAFE_FEE_LINE)) {
          this.used.add(SAFE_FEE_LINE);
          out.push(`${SAFE_FEE_LINE} `);
        }
        continue;
      }
      // See SAFE_COVERAGE_LINE: whether one job falls under the warranty is
      // the manager's call, not Grace's.
      if (!isQuestion(sentence) && COVERAGE_CLAIM.test(plain) && !COVERAGE_HEDGE.test(plain)) {
        this.actions.push("change_claim");
        if (!this.used.has(SAFE_COVERAGE_LINE)) {
          this.used.add(SAFE_COVERAGE_LINE);
          out.push(`${SAFE_COVERAGE_LINE} `);
        }
        continue;
      }
      // See SAFE_NEW_BUILD_LINE: whether they take ground-up new builds is
      // not in the knowledge, and a six-townhome lead is too big to guess at.
      if (
        !isQuestion(sentence) &&
        NEW_BUILD_SCOPE_CLAIM.test(plain) &&
        !NEW_BUILD_HEDGE.test(plain)
      ) {
        this.actions.push("fee_claim");
        if (!this.used.has(SAFE_NEW_BUILD_LINE)) {
          this.used.add(SAFE_NEW_BUILD_LINE);
          out.push(`${SAFE_NEW_BUILD_LINE} `);
        }
        continue;
      }
      // See SAFE_PRICE_POLICY_LINE: a surcharge, discount or promotion
      // stated as fact, either way round, when nothing published says so.
      if (
        !isQuestion(sentence) &&
        PRICE_POLICY_WORDS.test(plain) &&
        PRICE_POLICY_CLAIM.test(plain) &&
        // See PRICE_POLICY_DENIAL: a surcharge said to APPLY is published
        // and errs the safe way, so only a denial, or a promise of money
        // off, is replaced.
        (PRICE_POLICY_DENIAL.test(plain) || PRICE_POLICY_BENEFIT.test(plain)) &&
        // 2026-11-06: there is NO residential referral discount, confirmed
        // by the client, so saying so is now an answer rather than a guess.
        // Only the denial is let through: a commercial programme does exist
        // but it is "GPL only", which nobody has explained, so Grace must
        // still never claim a referral discount EXISTS.
        !(/\breferral\b/i.test(plain) && PRICE_POLICY_DENIAL.test(plain)) &&
        !PRICE_POLICY_HEDGE.test(plain)
      ) {
        this.actions.push("fee_claim");
        if (!this.used.has(SAFE_PRICE_POLICY_LINE)) {
          this.used.add(SAFE_PRICE_POLICY_LINE);
          out.push(`${SAFE_PRICE_POLICY_LINE} `);
        }
        continue;
      }
      if (
        !isQuestion(sentence) &&
        PRICE_SCOPE_CLAIM.test(plain) &&
        !PRICE_SCOPE_HEDGE.test(plain) &&
        !/\b(?:off|coupon|discount)\b/i.test(plain)
      ) {
        this.actions.push("scope_claim");
        if (!this.used.has(SAFE_SCOPE_LINE)) {
          this.used.add(SAFE_SCOPE_LINE);
          out.push(`${SAFE_SCOPE_LINE} `);
        }
        continue;
      }
      if (!isQuestion(sentence) && CALL_AHEAD_CLAIM.test(plain) && !CALL_AHEAD_HEDGE.test(plain)) {
        this.actions.push("call_ahead_claim");
        if (!this.used.has(SAFE_CALL_AHEAD_LINE)) {
          this.used.add(SAFE_CALL_AHEAD_LINE);
          out.push(`${SAFE_CALL_AHEAD_LINE} `);
        }
        continue;
      }
      if (!isQuestion(sentence) && CAUSE_CLAIM.test(plain)) {
        this.actions.push("cause_claim");
        if (!this.used.has(SAFE_CAUSE_LINE)) {
          this.used.add(SAFE_CAUSE_LINE);
          out.push(`${SAFE_CAUSE_LINE} `);
        }
        continue;
      }
      if (CHANGE_CLAIM.test(plain) && !CHANGE_HEDGE.test(plain)) {
        this.actions.push("change_claim");
        if (!this.used.has(SAFE_CHANGE_LINE)) {
          this.used.add(SAFE_CHANGE_LINE);
          out.push(`${SAFE_CHANGE_LINE} `);
        }
        continue;
      }
      if (
        STREET_READBACK.test(plain) ||
        DIGIT_READBACK.test(plain) ||
        (this.houseNumber !== null && mentionsHouseNumber(plain, this.houseNumber))
      ) {
        slow = true;
      }
      // One question per turn, as the prompt asks. 2026-10-23, real-model QA
      // on gpt-4o-mini (the production model), on the live code as well:
      // "What seems to be the problem today? Is it happening right now?" The
      // caller can answer only one; the second is dropped, never the first.
      if (isQuestion(sentence) && this.questionsThisTurn.length > 0) {
        this.actions.push("second_question");
        continue;
      }
      if (isQuestion(sentence)) {
        this.questionsThisTurn.push(normalizedWords(sentence));
      }
      this.wordsSoFar += sentenceWordCount;
      let kept = isQuestion(sentence)
        ? plainSpoken(sentence)
        : plainSpoken(sentence).replace(OWN_TODAY, "right away");
      kept = this.withoutAStrangersName(kept);
      kept = this.withTheRealSpelling(kept);
      const numbered = withTheRealNumber(kept, this.knownPhones);
      if (numbered !== kept) {
        this.actions.push("wrong_phone_readback");
        kept = numbered;
        slow = true;
      }
      if (slow) {
        kept = hyphenateHouseNumber(kept, this.houseNumber);
      }
      out.push(kept);
    }
    // Keep the segment's own edge whitespace: segments are streamed one after
    // another, and a lost leading space would glue two spoken words together.
    const leading = segment.match(/^\s*/)?.[0] ?? "";
    const trailing = segment.match(/\s*$/)?.[0] ?? "";
    let body = out.join("").trim();
    if (!body) {
      return "";
    }
    this.spokeAlready = true;
    // Consolidate delivery cues: the model sometimes puts [slowly] on every
    // sentence, producing robotic stacking. Strip all internal cues and let
    // the guard add one at the front when a readback is present.
    body = body.replace(/\[slowly\]\s*/gi, "").trim();
    if (!body) {
      return "";
    }
    if (slow && !/^\[slowly\]/i.test(body)) {
      this.actions.push("slow_readback");
      body = `[slowly] ${body}`;
    }
    return `${leading}${body}${trailing}`;
  }
}
