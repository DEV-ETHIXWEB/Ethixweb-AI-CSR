# 04 — Objection and Frustration Handling

## "I already told you that"

Implemented: v16 — _"If a caller says something like 'I already told you that' or is clearly
frustrated that you asked again, don't apologize repeatedly and don't defend yourself — briefly
own it ('you're right, I've got that') and move on with whatever you actually have; dwelling on
the mistake makes it worse, not better."_

**Real-model evidence**: the "v16: 'I already told you'" scenario in `scripts/measure-
conversation-quality.ts` reproduced the exact intended phrasing — _"You're right, I've got that."_
— followed by moving on to a genuinely new question, not re-litigating the point.

## General repeated-question avoidance (the caller redirects instead of directly objecting)

Implemented: v13 — _"If you've now asked for the SAME piece of information twice and the caller
still hasn't given it directly, stop asking for it a third time."_

**Known gap, stated honestly**: real-model testing (the adversarial "v13: caller repeatedly does
not answer" scenario) showed this rule is not fully reliable — in one verified run, the model
asked for a phone number **five times in a row**, including once immediately after the caller said
"Yes, that's everything, thanks," a clear close signal. v15/v16 narrowed this gap for two specific,
previously-observed cases (address and service-area/zip fixation — both now fixed at the schema or
prompt level with real-model confirmation) but the fully general case — a caller who simply never
gives a _genuinely required_ field like phone number — remains only partially mitigated by prompt
wording, because `phone` is a real, multi-layer required field in core-api (DTO validation +
Prisma `NOT NULL` + a uniqueness constraint + CRM sync code) that a prompt instruction cannot make
optional. A durable fix needs a database migration and CRM-sync code changes, correctly out of
scope for a prompt-layer pass — see the relevant commit's own reasoning for the full trace.

## Emotional escalation (angry, panicked, worried)

Implemented: base prompt — _"When a caller sounds upset, scared, or is describing active damage
happening right now ... briefly acknowledge that like a person would before moving on to
questions — one short human reaction, not a canned phrase, and not a long detour."_

Deliberately **does not** instruct elaborate, effusive empathy — the target is a brief, genuine
human reaction ("Yeah, I understand — let's get this figured out"), not _"I'm deeply sorry you're
experiencing this incredibly frustrating situation,"_ which reads as scripted, not natural.

**Real-model evidence**: the "urgency and emotion" scenario shows a brief acknowledgment followed
by practical help. See `02-conversation-patterns.md` for the honest caveat on the one observed
(non-reproducible) case where a direct follow-up question was ignored.

## Never apologizing for a technical/tool failure

Implemented: base prompt — _"If a tool call comes back unavailable, errored, rejected, or degraded
for ANY reason ... never say so, never say 'let me try that again,' and never apologize for a
technical issue; the caller should never hear that anything went wrong on your end."_

This is deliberately about **the model's own tool failures**, not the caller's frustration — a
distinct rule from the "I already told you" ownership rule above. Confusing the two would mean
either apologizing for things that aren't the caller's concern, or failing to own things that
genuinely are.

## Known gaps

- The fully-general "caller never answers a required field" case is a real, acknowledged,
  currently-open limitation — see above. Do not claim this is solved; it is measurably improved
  for two specific fields, not universally fixed.
- No dedicated scenario yet tests genuine anger (as opposed to frustration-at-repetition or panic)
  against the real model.
