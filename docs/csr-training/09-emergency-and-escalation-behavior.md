# 09 — Emergency and Escalation Behavior

## escalateEmergency is called unconditionally, every time

Implemented: base prompt (v7, hardened from an earlier conditional version) — _"As soon as the
caller describes their problem, call escalateEmergency before asking any further qualifying
questions — every single time, even when it seems obviously urgent or obviously routine to you.
Your own read is never a substitute for the tool, in either direction."_

The earlier, conditional version ("call it if unsure") was found live to give the model exactly the
escape hatch a confident-sounding case doesn't need — skip the tool because it already "knows" the
answer. The business may have its own configured emergency rules the model has no way to know
about; skipping the call because the model feels confident is exactly how a real emergency gets
missed, or a routine call gets escalated unnecessarily.

## The model never narrates its own severity judgment

Implemented: base prompt — _"regardless of what it returns, never tell the caller your own read on
how serious or urgent their situation is; continue naturally into either the transfer or the next
question."_ The tool's decision drives behavior; the model's own opinion about how urgent something
sounds is never spoken aloud, in either direction (never downplaying, never dramatizing).

## Escalation result drives createLead's priority field, not a separate judgment call

Implemented: base prompt — if `escalateEmergency` returns `action: "forward_call"` or
`"priority_notify"`, `priority` must be set to `"emergency"` or `"urgent"` respectively when
`createLead` is called for that caller. This is a direct, mechanical mapping specifically so the
human notification's urgency reflects the tool's decision, not a second, potentially-inconsistent
judgment made when constructing the lead.

## Human transfer requests are never gatekept

Implemented: base prompt v8 — a caller asking to speak to a real person gets an honest answer about
being an automated assistant and an immediate offer to connect them, never more qualifying
questions first as a delay tactic.

## Real distress gets acknowledged before questions continue

See `04-objection-and-frustration-handling.md` for the full rule and its honest, partially-verified
evidence (3 of 4 repeated real-model runs of an active-emergency scenario handled a direct
follow-up question correctly; 1 of 4 did not).

## Known gaps

- "False emergency" (a caller describing something that sounds urgent but the business's own rules
  classify as routine, or vice versa) has no dedicated real-model test — `escalateEmergency`'s own
  classification logic is core-api's responsibility (`docs/07-notification-and-emergency.md`), not
  this prompt layer's; this file only covers how the model behaves once the tool has answered.
- No test yet covers a caller who explicitly disputes the emergency classification ("this isn't an
  emergency, don't transfer me" after the tool already returned `forward_call`).
