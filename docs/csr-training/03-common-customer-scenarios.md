# 03 — Common Customer Scenarios

Each scenario below states: what a good human CSR does (from the one real training transcript, or
general dispatcher practice where the transcript doesn't cover it), what this system currently
does, and the evidence for that claim. Examples are illustrative and use invented names/addresses
— never real caller data.

## New customer, straightforward problem

**Good CSR pattern**: let them explain, paraphrase back, collect only what's needed, describe next
steps briefly.
**This system**: v12's whole rule set targets exactly this. Real-model-verified across multiple
scenarios (`Name handling`, `Conversational memory`, `v12: property-manager call`).

## Returning customer (recognized by phone number)

**Good CSR pattern**: caller-ID lookup happens before the caller even finishes saying hello; the
CSR greets them by name without asking who's calling.
**This system**: v16, real-model-verified — `searchCustomer` is called with the caller's own ANI
value as one of the model's first actions, and the matched name is used naturally
("Marcus, I've got you here").
**Known gap**: `RuntimeContext.existingCustomerMatch` (the field designed to carry a _pre-run_
lookup result into the greeting itself, before the first turn) is currently always `null` at call
start (see `start-conversation.use-case.ts`'s own comment) — the lookup happens via the model
calling the tool mid-conversation, not automatically before the greeting. A returning caller is
still asked to explain their problem before being recognized; they are not yet greeted by name on
the very first line.

## Customer with an existing/upcoming appointment or callback

**Good CSR pattern**: recognizes context immediately, does not restart qualification.
**This system**: `lookupPreviousCalls` exists and is available to the model, but there is no
prompt rule instructing _when_ to call it or how to use call-history results to skip
re-qualification. This is a real, currently-untested gap — not fabricated as covered.

## Scheduling / rescheduling / cancellation

**Good CSR pattern** (per the training transcript) — this platform's own architecture deliberately
does **not** give the CSR real scheduling authority: _"you never schedule, promise a specific
appointment time, or quote a price"_ (base prompt, load-bearing). The training transcript's own
example of offering a specific window ("tomorrow morning, 8 to 10") was explicitly **not**
adopted (v12's own comment) because there is no real availability-checking integration to back
that promise. This is a deliberate, documented product boundary, not an oversight.
**This system**: says a team member will follow up to confirm scheduling. Cancellation/reschedule
of an _existing_ job has no dedicated tool or prompt rule yet.

## Price / estimate question

See `08-pricing-and-availability-behavior.md` for the full rule set.

## Service area / business hours question mid-flow

**This system**: v16, real-model-verified — a direct "are you open right now?" mid-flow gets
answered via `getBusinessHours` rather than deferred (see `01-csr-behavior-model.md` for the
honest caveat on phrasing smoothness).

## Emergency / active damage

See `09-emergency-and-escalation-behavior.md`.

## Frustrated / "I already told you"

See `04-objection-and-frustration-handling.md`.

## Topic change mid-explanation

See `06-topic-change-rules.md`.

## Caller asks if the CSR is human/AI, or asks for a human

**This system**: base prompt v8 — always answers honestly when asked seriously, never gatekeeps a
transfer request with more questions first. v14 separately handles _playful_ versions of this
question ("how old are you?") with a warm deflection, explicitly distinct from the serious-honesty
rule.

## Unrelated/off-topic question

No dedicated rule beyond v16's general "current intent first" principle — the model is expected to
answer what it can and return to the problem, the same mechanism used for pricing/hours questions.
Not separately real-model-tested for a genuinely unrelated (non-business) question.

## Known gaps (repository-wide for this file)

- Returning-caller recognition happens mid-call via a tool call, not at greeting time.
- No prompt guidance for `lookupPreviousCalls` usage.
- No dedicated reschedule/cancellation handling for an existing job.
- Off-topic (non-business) questions are untested against the real model.
