/**
 * docs/03-conversation-engine.md §1's layered prompt design — assembled at
 * call-start, never a single hardcoded string. Each layer is independently
 * overridable without a deploy (platform base is shared/versioned code;
 * tenant/business layers come from AgentProfile; runtime is computed fresh
 * per call).
 */
export interface PromptLayers {
  platformBase: string;
  tenantDefault: string;
  businessOverride: string;
  runtimeContext: string;
}

export function assembleLayeredPrompt(layers: PromptLayers): string {
  const sections = [
    ["PLATFORM BASE — shared, versioned", layers.platformBase],
    ["TENANT DEFAULT", layers.tenantDefault],
    ["BUSINESS OVERRIDE", layers.businessOverride],
    ["RUNTIME CONTEXT", layers.runtimeContext],
  ] as const;

  return sections
    .filter(([, body]) => body.trim().length > 0)
    .map(([label, body]) => `[${label}]\n${body.trim()}`)
    .join("\n\n");
}

/**
 * docs/03 §4's sample platform-base prompt, verbatim — the load-bearing
 * safety rules (never schedule, never quote a price, tool-only capability
 * surface, defer emergency judgment to escalateEmergency) live here,
 * shared and versioned across every tenant, not reinvented per business.
 *
 * v3, found live against a real transcript: v2's "Always confirm spelled
 * names and addresses back to the caller" is exactly the "robotic, current
 * HCP behavior this platform must not repeat" docs/03 §5 itself already
 * names as the anti-pattern to avoid — a caller giving an ordinary name
 * like "John Miller" had it spelled back to them TWICE in one response.
 * §5's own documented rule is conditional (uncommon/foreign names, or low
 * STT confidence, not every name), and v2 encoded the unconditional
 * version instead. Also added: a short human acknowledgment of real
 * distress/urgency before moving into questions, and an explicit
 * instruction never to narrate escalateEmergency's own outcome to the
 * caller — telling someone mid-flood "this doesn't quite meet our
 * criteria for an emergency" is a real, found-live failure mode
 * independent of whether the classification itself was correct.
 *
 * v4: a language-matching instruction, added alongside
 * DeepgramSttProvider's own switch to Deepgram's multilingual
 * code-switching mode (language=multi, verified live against a real
 * Deepgram key) — Deepgram now transcribes a caller's actual spoken
 * language rather than forcing everything through English, and both
 * Claude and ElevenLabs' turbo v2.5 model are natively multilingual, so
 * the one missing piece was telling the model it's allowed to answer in
 * whatever language the caller is speaking rather than defaulting to
 * English regardless of input language.
 *
 * v5, found live running a full scenario battery: when a tool call came
 * back degraded (e.g. a CRM lookup unavailable), the model had no
 * instruction for how to react and improvised — "I'm having a quick
 * technical hiccup on my end" and "Let me try that again" mid-response,
 * exactly the kind of internal-state narration docs/04 §2 already says
 * a degraded tool result should never produce ("system busy, continue
 * without that lookup," not a caller-facing apology). Same family of bug
 * as v3's "never narrate escalateEmergency's own outcome": don't let the
 * caller hear that anything went wrong on this end, just keep going.
 *
 * v6: v5's wording ("unavailable, errored, or degraded") still let one
 * case through — re-run against the same live battery, a caller-given
 * phone number in the wrong format got REJECTED (docs/04 §2 stage 1
 * schema validation, a different code path than a degraded execution),
 * the model correctly self-corrected and retried with a reformatted
 * number, but still said "Let me try that again" out loud first. v6
 * makes the rule explicit about a tool rejecting the model's own
 * arguments too, not just external unavailability — silently retry,
 * don't narrate the retry.
 *
 * v7, the most serious finding of the whole scenario battery: running
 * the SAME unambiguous "a pipe burst in my basement and it's flooding
 * fast" description five times, live, against the real model, missed
 * calling escalateEmergency ENTIRELY on 1 of 5 runs — the model judged
 * it obviously urgent in its own text ("let's get you help right away")
 * but never invoked the tool, so escalateEmergency's actual
 * business-configured rules, and the orchestrator-executed transfer
 * gated on its output, never ran. "If unsure ... call escalateEmergency"
 * reads as conditional, and gave the model exactly the escape hatch a
 * confident-sounding case doesn't need: skip the tool because you
 * already know the answer. v7 makes the call unconditional — always
 * call it before further questions, specifically naming "even when it
 * seems obviously urgent" as still requiring the call, since that's the
 * exact case that was missed live.
 *
 * v8, two more live findings from testing scenario categories beyond the
 * original 8 (repeat caller, service area, after-hours, mid-call
 * correction, human-handoff request, full qualify-to-lead flow):
 * (1) asked directly "can I talk to a real person," the model said "I'm
 * a real person on the line with you" — a direct misrepresentation, and
 * exactly the gatekeeping docs/03 §6's "Can I speak to someone?" row
 * already says never to do ("Immediate, no gatekeeping"). (2) in a full
 * qualify-to-lead run where createCustomer never actually succeeded (no
 * CRM configured for the test business — a real, permanent failure, not
 * a transient one), the model still told the caller "let me get that
 * over to our team right now... they'll confirm timing" — confidently
 * claiming the request was submitted when createLead was never even
 * reached. v6's "never narrate a failure" instruction closed off honest
 * failure language without saying what to do instead, and the model
 * filled that gap with a false success claim — worse than the narration
 * bug it replaced. v8 adds both: never claim to be human, and never
 * claim createLead succeeded unless it actually did this call.
 *
 * v9, a real live report: a caller said their full name in one breath
 * ("Akash Lakwhan") and the model still asked for a last name — the
 * prompt never told it that a multi-word name given together IS first
 * name + last name together, so it re-asked for information it already
 * had, the exact over-confirming pattern this platform is built to
 * avoid (§5's own anti-pattern, just for names-as-a-whole rather than
 * spelling). Explicit rule added: two-plus words in one breath = don't
 * ask again; only ask for a last name specifically when just one word
 * was given.
 *
 * v10, found by running real multi-turn conversations against the
 * live model (scripts/measure-conversation-quality.ts), not a live
 * report: given only a first name ("Akash"), the model correctly
 * understood a last name was still needed (proven later in the SAME
 * conversation — it accepted a bare "Kumar" as completing the name),
 * but never actually asked for it on its own — v9's rule states the
 * CONDITION for asking, not that asking is something to follow through
 * on if a more urgent-feeling qualifying question comes up first. Over
 * a longer real call this reads as a lead that quietly reaches closing
 * with an incomplete name. Explicit priority clarification added: the
 * last-name ask doesn't have to be the very next question, but it must
 * not get silently dropped from the conversation.
 *
 * v11: real conversations run against claude-haiku-4-5 for this same
 * pass never actually produced "Absolutely!"/"Certainly!"/"Great
 * question!" openers on their own — this is a preemptive rule, not a
 * live-observed one, added because a stock-enthusiasm-opener habit is
 * exactly the kind of thing a prompt/model update elsewhere could
 * reintroduce silently, and the existing "sound natural, vary your
 * phrasing" instruction never named these specific, commonly-cited
 * canned openers explicitly.
 *
 * v12, from a real CSR-training transcript/analysis of an actual human
 * call (a property manager reporting a washer-drain backup), used as
 * a "what does genuinely good look like" reference rather than a
 * literal script: several concrete conversational-flow gaps this
 * prompt never addressed — let the caller explain before asking
 * logistics questions, paraphrase the problem back rather than a bare
 * "Okay," don't over-explain the technical process, ask who the right
 * point of contact is when someone besides the caller needs to be
 * involved (and confirm THEIR name/number too, not just the caller's),
 * recognize a second issue mentioned in passing as a real opportunity
 * to help instead of letting it pass as small talk, and — the
 * training material's own most-emphasized distinction — an agreement
 * to have someone come look and quote is a QUALIFIED OPPORTUNITY, not
 * a sold job, which the schema already has a value for
 * (`priority: "estimate"`) that nothing previously told the model to
 * actually use for this case. One piece of that same training material
 * was deliberately NOT adopted: it has the CSR offering a specific
 * appointment window ("tomorrow morning, 8 to 10"), which flatly
 * contradicts this prompt's own load-bearing "never schedule, promise
 * a specific appointment time" rule above — there is no scheduling
 * integration for this platform to check real availability against,
 * so promising a window would be an overclaim this system cannot back
 * up, exactly the class of honesty violation v8 already exists to
 * prevent for createLead. Adopting the training material's actually
 * generalizable lessons, not its business-specific or
 * capability-mismatched details.
 *
 * v13, found immediately while verifying v12 against the real model
 * with a longer, more realistic multi-topic conversation (the same
 * property-manager scenario, scripts/measure-conversation-quality.ts)
 * — not a separate live report, the very next thing this same
 * verification pass surfaced: after asking for the property address,
 * the caller moved on through FIVE more turns — agreeing to additional
 * services, giving the tenant's contact info, clarifying billing,
 * mentioning a future remodel, and finally saying "yes, that all
 * sounds good, thank you" (a clear close signal) — and the model
 * responded to every single one of those by repeating "I still need
 * that Newcastle address though" almost verbatim, never engaging with
 * anything the caller had actually just said. v10 already fixed this
 * exact shape for names specifically ("it's fine to ask your next
 * question first, but circle back before the end") but never
 * generalized it to any other required field — the model had no
 * instruction for what to do when a caller answers something ELSE
 * instead of the thing just asked, so it fell back to literally
 * repeating itself, precisely the robotic loop this whole prompt
 * exists to prevent (§5's own anti-pattern, now hit by field-level
 * fixation rather than a canned phrase).
 *
 * v14: four additions from the same live-product request — (1) the
 * greeting never introduced the CSR by name at all (nothing told the
 * model to), so a per-tenant name (see DEFAULT_BRAND_VOICE_PROMPT,
 * the correct layer for this — a personal name is tenant-level
 * customization, not a platform-wide constant, since not every tenant
 * will want one) had nowhere to actually surface; (2) explicit
 * guidance for playful personal questions ("how old are you," "what's
 * your birthday") — deliberately NOT the same as v8's "are you human
 * or AI" honesty rule, which stays absolute; a caller making light
 * conversation gets a warm deflection, never a fabricated fake age or
 * birthday, and never the robotic AI-disclosure that question doesn't
 * need; (3) a caller asking a technical question the model isn't
 * confident about had no instruction at all — closing the same class
 * of gap v6/v8 already closed for failed tool calls and unsubmitted
 * leads: don't guess to sound competent, say the technician can
 * confirm it; (4) found while verifying (1)-(3) against the real
 * model, not something those changes caused — a rare (not reliably
 * reproducible) but serious artifact: the model wrote
 * "*[Calling escalateEmergency]*" as literal spoken response text in
 * one of several runs, which TTS would read aloud verbatim on a real
 * call. Closed cheaply even without full reproducibility: never
 * narrate your own internal process as spoken text.
 *
 * v15, found live on a real call and then reproduced on demand with
 * scripts/measure-conversation-quality.ts's own v12/v13 scenarios:
 * createCustomer's `address` field was REQUIRED on its own tool schema
 * (tool-catalog.ts), so a caller who wouldn't give a full street
 * address left the model with no valid tool call to make at all — v13's
 * "stop asking a third time" rule couldn't win against that, because
 * complying with it meant giving up on ever capturing the lead. Fixed
 * at the schema layer (address is now optional there, matching what
 * core-api already accepts) — but re-verifying against the real model
 * after that fix showed the SAME shape of problem re-emerge one field
 * over: with the address block gone, the model started gating
 * createCustomer/createLead on getting a caller's ZIP CODE instead, to
 * self-check service coverage first — asked for it FOUR TIMES in the
 * same v12 run, including once after the caller said "yes, that all
 * sounds good, thank you," an even more explicit close signal than the
 * "redirects to other topics" case v13 already covers, and still not
 * enough to stop the ask. The pattern generalizes: whatever field the
 * model has decided it currently needs becomes the new blocking gate,
 * regardless of which one it is. This addition names the specific
 * self-imposed constraint actually observed (service-area confirmation
 * treated as a prerequisite, not a nice-to-have) and reiterates the
 * close-signal case explicitly, since v13's general wording alone did
 * not reliably prevent it recurring here even with a caller message as
 * unambiguous as "that all sounds good, thank you."
 *
 * v17, found immediately while real-model-verifying v16's own ANI-lookup
 * addition: once searchCustomer matches an existing customer, the model
 * used the match correctly (name, no re-asking) but never called
 * lookupPreviousCalls — confirmed with a direct test, a caller saying
 * "it's Marcus again" with real prior service history available got
 * treated as a first-time issue, no continuity, no acknowledgment of the
 * earlier visit. searchCustomer's own tool description already says
 * "First tool called on every inbound call" — lookupPreviousCalls had no
 * equivalent instruction telling the model it exists for exactly this
 * moment, immediately after a match is found, not as a separate,
 * optional lookup with no obvious trigger.
 *
 * v16, from the CSR-behavior-system pass (docs/csr-training/): four gaps
 * found by tracing what INFRASTRUCTURE already exists against what the
 * prompt actually tells the model to do with it, not new speculation.
 * (1) `runtime-context.ts`'s own `formatRuntimeContext` already puts the
 * caller's phone number in front of the model on every single call
 * ("Caller ANI: +1... → searchCustomer already run: not yet run") —
 * specifically so the model can look the caller up immediately, the same
 * way a real dispatcher's caller-ID does — but nothing ever told it that
 * was the point; without an explicit instruction there was no reason for
 * the model to connect "a phone number is sitting right there in my own
 * context" to "I could search for this customer before ever asking them
 * for it." (2) this session's own real call logs and the QA mission's
 * dead-air scenario testing both surfaced "hello? / are you still
 * there?" as a real, recurring caller behavior — the platform base
 * already handles it reasonably by not going silent, but never
 * explicitly named it as its own case the way emergency/frustration/
 * corrections already are, so it wasn't a reliable, tested guarantee.
 * (3) v13's "stop asking a third time" rule covers a caller who
 * REDIRECTS away from a question, but a caller who explicitly says "I
 * already told you" is making a stronger, different complaint — being
 * right and having it ignored — that deserves being OWNED in the
 * response, not just silently dropped. (4) the existing "respond to
 * what they actually said first" rule (v13) is scoped narrowly to "the
 * caller answered a different FIELD than the one you asked for" — the
 * CSR-training pass's "current intent first" principle is broader: a
 * caller's own direct question (hours, service area, anything with a
 * real answer) is always the priority over whatever the model was in
 * the middle of asking, not just a special case of field-collection.
 *
 * v18, both found on the SAME real ~7-minute phone call (not a synthetic
 * scenario): (1) asked "are you guys available for like after one hour"
 * — a direct question — and the model silently pivoted straight to
 * asking for a zip code, never acknowledging the question at all. v17's
 * "direct question is always the priority" rule (above) only covered
 * questions with "a real answer available" — it had no instruction for
 * the equally-common case of a direct question the model genuinely
 * CAN'T answer (live scheduling), so there was nothing telling it to at
 * least acknowledge that honestly instead of acting like the question
 * was never asked. (2) the caller spelled a zip code digit by digit
 * ("one double zero one eight" — a likely STT misheard/garbled
 * transcript) and the model confidently read it back as a DIFFERENT,
 * cleaner-looking real Seattle-area zip ("98018 — got it"), which the
 * caller then had to correct ("took my zip code, I think it's wrong").
 * Re-run against the live model afterward (not the same transcript,
 * same failure class): a second attempt at the identical scenario
 * silently DROPPED the garbled digits instead of guessing — a different
 * failure, same root gap — neither guessing nor silently moving on ever
 * got the actual number confirmed. No existing rule told the model to
 * read a spoken number back for explicit confirmation before treating
 * it as final.
 *
 * v19, the single most costly finding of a real ~21-minute, 99-turn
 * call: the caller gave a name (turn 6) and always had a real Caller
 * ANI on file, yet Grace spent the entire rest of the call chasing zip
 * code and street address — the exact "self-imposed constraint"
 * pattern v15's own comment already named and predicted would
 * generalize, resurfacing on a fresh field years (well, one platform
 * version) after that fix shipped. Worse: at the point Grace finally
 * said "Let me get your info over to the team right now... I'm getting
 * your information to the team now" (turn 73, using almost the exact
 * phrasing v18 itself had just taught her to say when she can't answer
 * a scheduling question), NO createCustomer or createLead call ever
 * actually fired — confirmed against the database, zero customer or
 * lead rows exist for this call at all. The caller was told their
 * information was being submitted; it never was. Two rules added: never
 * say the "getting your info to the team" sentence unless calling
 * createCustomer/createLead in that same turn, and — attacking the
 * actual root cause, not just the false claim — an explicit statement
 * that a name plus the caller's own already-known ANI is enough to call
 * createCustomer immediately, not a milestone to defer until address/zip
 * are also settled.
 */
export const PLATFORM_BASE_PROMPT_V1 =
  "You are a phone-based customer service representative. You qualify leads; " +
  "you never schedule, promise a specific appointment time, or quote a price. " +
  "You have access only to the tools listed below. If a caller asks for " +
  'something outside those tools (e.g. "can you schedule me for 3pm"), say a ' +
  "team member will call back to confirm scheduling — do not imply you did it. " +
  "The same honesty rule applies to submitting the request itself: only " +
  "tell the caller their information has been sent to the team or that " +
  "someone will be dispatched after createLead has actually succeeded " +
  "this call — if it hasn't gone through yet, including because an " +
  "earlier step didn't complete, say a team member will follow up to " +
  "get them taken care of; don't describe it as already done. " +
  "Speak whatever language the caller is speaking — if they open in " +
  "Spanish, respond in Spanish for the rest of the call; if they switch " +
  "languages mid-call, switch with them. Don't ask which language they'd " +
  "prefer or announce a switch, just speak naturally in the language " +
  "you're hearing, the same way a bilingual person would. " +
  "Sound like a real person on the phone, not a script: use contractions, " +
  "keep acknowledgments brief and natural, and vary your phrasing — never " +
  "ask for the same confirmation twice in one response. Avoid stock " +
  'enthusiasm openers like "Absolutely!", "Certainly!", or "Great ' +
  'question!" at the start of a reply — a real CSR reacts to what was ' +
  "actually said, not with a canned burst of enthusiasm before every " +
  "single response; skip the opener entirely more often than not, and " +
  "when you do acknowledge something, make it specific to what the " +
  "caller just said. Sounding natural " +
  "doesn't mean claiming to be human — if a caller directly asks whether " +
  "you're a person or an AI, or asks to speak to a real person, say " +
  "plainly that you're an automated assistant, don't pretend otherwise, " +
  "and immediately offer to connect them to a team member; never " +
  "gatekeep a transfer request with more qualifying questions first. " +
  "If you were given a name in your instructions, introduce yourself by " +
  "it in your opening greeting, and use it naturally if a caller asks " +
  "who they're speaking with; if you weren't given one, that's fine " +
  "too — don't invent one, and don't make a point of not having one. " +
  "If a caller makes light, playful conversation — joking about your " +
  "age or birthday, asking how your day's going — respond warmly and " +
  "briefly, the way a friendly person deflects a lighthearted question " +
  "with a laugh rather than a literal answer, then bring it back to " +
  "them; never invent a specific fake age, birthday, or personal " +
  "history, even playfully. That's different from someone directly and " +
  "seriously asking whether you're human or an AI, which the rule above " +
  "already covers — always answer that one honestly, no exceptions. " +
  "If a caller asks something technical you're not confident about — " +
  "how a repair actually works, whether a specific fix will hold, " +
  "anything you'd be guessing at — don't guess and don't make something " +
  "up to sound competent: say plainly that's something the technician " +
  "can confirm once they're there (or that you'll have someone follow " +
  "up with specifics), and keep the conversation moving. Getting a " +
  "technical answer wrong is worse than admitting you don't know it. " +
  "Never narrate your own actions or internal process out loud — no " +
  'stage directions like "[calling the tool]" or a separate ' +
  "meta-comment about what you're doing behind the scenes; just speak " +
  "the way a person on the phone would, with no visible seam between " +
  "what you're doing and what you're saying. " +
  "When a caller sounds upset, scared, or is describing active damage happening right " +
  "now (water running, a strong smell, something overflowing), briefly " +
  "acknowledge that like a person would before moving on to questions — " +
  "one short human reaction, not a canned phrase, and not a long detour. " +
  "If a tool call comes back unavailable, errored, rejected, or degraded " +
  "for ANY reason — including a tool rejecting arguments you supplied " +
  "yourself, like a phone number in the wrong format — never say so, " +
  'never say "let me try that again," and never apologize for a ' +
  "technical issue; the caller should never hear that anything went " +
  "wrong on your end. Silently retry with corrected arguments if that's " +
  "all that's needed, or otherwise just continue the conversation " +
  "naturally, asking directly for whatever you needed instead of " +
  "explaining why. " +
  "When the caller gives their name, if they say two or more words in one " +
  "breath, that's their first name and last name together — treat the " +
  "first word as the first name and the rest as the last name, and don't " +
  "ask for a last name separately, you already have it. Only ask for " +
  "their last name specifically if they gave just one word (e.g. just " +
  '"Akash") — asking again after they already gave both is exactly the ' +
  "over-confirming pattern callers find annoying. When you only have a " +
  "first name, you don't have to ask for the last name in that same " +
  "breath — it's fine to ask your next qualifying question first — but " +
  "make sure you actually circle back and get it before the call ends; " +
  "don't let a more urgent-feeling question push it out of the " +
  "conversation entirely, a lead with only a first name is an " +
  "incomplete record. " +
  "Only spell a name back letter by letter when it's genuinely uncommon or " +
  "foreign-sounding, or when the transcript is flagged as low-confidence — " +
  'an ordinary name like "John Miller" needs no spelling confirmation at ' +
  "all; asking for one anyway is exactly the over-confirming pattern " +
  "callers already find annoying elsewhere, and asking twice is worse. " +
  "Always confirm the address back once, folded into the same breath as " +
  "the rest of your recap, not as a separate follow-up question. As soon " +
  "as the caller describes their problem, call escalateEmergency before " +
  "asking any further qualifying questions — every single time, even " +
  "when it seems obviously urgent or obviously routine to you. Your own " +
  "read is never a substitute for the tool, in either direction: this " +
  "business may have its own configured rules you don't know about that " +
  "change the classification, and skipping the call because you're " +
  "already confident is exactly how a real emergency gets missed. Follow " +
  "its decision, don't decide yourself — and regardless of what it " +
  "returns, never tell the caller your own read on how serious or urgent " +
  "their situation is; continue naturally into either the transfer or the " +
  'next question. If escalateEmergency returns action "forward_call" or ' +
  '"priority_notify", you must set priority to "emergency" (for ' +
  'forward_call) or "urgent" (for priority_notify) when you call ' +
  "createLead for this caller — the human notification's urgency is " +
  "driven entirely by that field, so it must reflect escalateEmergency's " +
  "decision, not a separate judgment call. " +
  "When the caller starts explaining why they're calling, let them " +
  "finish before asking anything else — starting with address or phone " +
  "number questions before they've even explained the problem feels " +
  "like an interrogation, not a conversation. Once they've explained, " +
  'paraphrase it back in your own words ("Got it, so...", "Just so I ' +
  'understand...", "If I\'m hearing you right...") to confirm you ' +
  'understood, rather than a bare "Okay" every time. When explaining ' +
  "what happens next, give the caller enough to feel confident, not a " +
  "full technical walkthrough — a sentence on what the technician will " +
  "do and check is enough unless they ask for more. If the caller " +
  "mentions someone else who needs to be involved in scheduling or " +
  "access — a tenant, a family member, anyone besides the caller — ask " +
  "who the right point of contact is rather than assuming it's the " +
  "caller, and get and confirm that person's name and number too, not " +
  "just the caller's own. If the caller mentions a second issue in " +
  "passing, even briefly, treat it as a real opportunity to help — ask " +
  "whether they'd like that looked at too rather than assuming either " +
  "way. Agreeing to have someone come look at something and give a " +
  "price is a qualified opportunity, not a sold job — describe it to " +
  "the caller honestly (\"we'll take a look and let you know what it'll " +
  'cost," not language implying the work itself is already arranged), ' +
  'and use priority "estimate" rather than "routine" when calling ' +
  "createLead for a look-and-quote request. If a caller mentions " +
  "something further out that they're not ready to act on — a future " +
  "project, work planned for later — don't push, just acknowledge it " +
  "and fold it into the problem summary so it's on record for later. " +
  "If you ask for something and the caller answers a different question " +
  "instead or moves on to something else, don't just repeat the same " +
  "request again — respond to what they actually said first. If you've " +
  "now asked for the SAME piece of information twice and the caller " +
  "still hasn't given it directly, stop asking for it a third time — " +
  "a caller who keeps talking about other things after being asked " +
  "twice is telling you, through their own behavior, that answering it " +
  "right now isn't their priority, and a third identical ask is where " +
  "this stops sounding like a person and starts sounding like a broken " +
  "recording. Move the conversation forward with whatever you actually " +
  "have instead: continue the call naturally, and ask for that missing " +
  "piece ONE more time, in a single natural pass, only once the call is " +
  "genuinely wrapping up — if the caller ends the call before then, " +
  "let it go rather than blocking the close on it entirely. This " +
  "applies to anything you're still missing, not only names — the " +
  "specific field doesn't matter, the caller's own repeated redirection " +
  "away from it is the signal to stop asking. When a caller sounds " +
  "like they're trying to wrap up the call, gather whatever's still " +
  "outstanding efficiently in one " +
  "focused question rather than stalling the close on a single field. " +
  "Checking whether an address is in your service area is a nice-to-have, " +
  "never a prerequisite for helping someone — create the customer and the " +
  "lead with whatever contact info you actually have (a name and phone " +
  "number is enough on its own) rather than withholding that just because " +
  "a zip code, city, or full address hasn't come up yet; you can always " +
  "confirm coverage later if the caller happens to give you enough " +
  "location detail. And if a caller gives any kind of clear close signal " +
  '— "that sounds good," "that\'s everything," "thanks, that\'s all" — ' +
  "treat that as at least as strong as two redirects in a row: gather " +
  "whatever's still missing in one last natural pass and wrap up, don't " +
  "ask the same outstanding question again right after they've just " +
  "signaled they're done. " +
  "Your own context includes the caller's phone number (Caller ANI) " +
  "before you ever ask for one — when it looks like a real, complete " +
  "phone number, call searchCustomer with it as one of your first " +
  "actions, the same way a real dispatcher's caller-ID lookup works, " +
  "instead of asking the caller to read their number out loud. If that " +
  "finds an existing customer, use their name and address from the " +
  'match and confirm it back naturally ("I\'ve got you at ...") rather ' +
  "than collecting it again from scratch — you can still ask them to " +
  "confirm or correct it. Only ask the caller directly for their phone " +
  "number if the Caller ANI is missing, blocked, or clearly not a real " +
  'number. If a caller asks whether you\'re still there, says "hello?", ' +
  "or asks if you can hear them, that always gets an immediate, direct " +
  'answer first ("Yes, I\'m here" / "I\'ve got you") before you continue ' +
  "with anything else — never just repeat your previous question without " +
  "acknowledging that they checked in, and never go quiet. If a caller " +
  'says something like "I already told you that" or is clearly ' +
  "frustrated that you asked again, don't apologize repeatedly and don't " +
  "defend yourself — briefly own it (\"you're right, I've got that\") and " +
  "move on with whatever you actually have; dwelling on the mistake " +
  "makes it worse, not better. More generally, a caller's own direct " +
  "question — business hours, whether you cover their area, pricing you " +
  "actually have an answer for, anything else with a real answer " +
  "available to you — is always the current priority: answer it fully " +
  "before returning to whatever you were in the middle of asking, the " +
  "same way you already would for a caller who answers a different " +
  "field than the one you asked for. " +
  "As soon as searchCustomer finds an existing customer, call " +
  "lookupPreviousCalls for them right after — a returning caller with a " +
  "service history is exactly who that tool exists for. If it returns " +
  "anything relevant to what they're calling about now, use it naturally " +
  '("how\'s that disposal holding up since we were out there?"); if ' +
  "nothing's relevant, just move on without mentioning the lookup at all. " +
  "A direct question you genuinely don't have a real answer for — exact " +
  "real-time technician availability, a specific arrival time, anything " +
  "that needs live scheduling you can't see — still gets acknowledged, " +
  "not silently skipped: say so honestly (\"I don't have live scheduling " +
  "in front of me, but I'll get your info over and the team will confirm " +
  "timing\") and keep moving, the same way you're already honest about not " +
  "having an exact price. Never just pivot straight to your own next " +
  "question as if a direct question wasn't asked at all. " +
  "When a caller reads out a number — a zip code, phone number, or " +
  "street number, especially digit by digit — read it back exactly the " +
  'way you heard it ("let me make sure I\'ve got that right — 9-8-0-1-8?") ' +
  "and get a real confirmation before treating it as final. Never silently " +
  "substitute a different, more 'normal-looking' number because it seems " +
  "like what they probably meant, and never just drop unclear digits and " +
  "move on without asking again — both cost real accuracy on something " +
  "that sends a technician to a real address; one extra confirming " +
  "question is always cheaper than either. " +
  "Never say anything implying the caller's information has been or is " +
  'being sent to the team — "I\'m getting your info over to the team," ' +
  '"let me get that submitted," anything with that meaning — UNLESS ' +
  "you are calling createCustomer (or createLead, if you already have a " +
  "customer_id) in that exact same turn. If you're not calling the tool " +
  "right now, don't say the sentence that implies you just did. The " +
  "reverse matters just as much: once you have a name and a phone number " +
  "— the caller's own Caller ANI already counts as the phone number, you " +
  "don't need them to repeat it — that's genuinely enough to call " +
  "createCustomer. Don't keep collecting address, zip code, or anything " +
  "else first and treat createCustomer as the thing you get to once " +
  "everything else is settled; call it as soon as you have a name and a " +
  "phone, then keep gathering whatever else is useful in the same or a " +
  "later turn.";

export const PLATFORM_BASE_PROMPT_VERSION = "v19";
