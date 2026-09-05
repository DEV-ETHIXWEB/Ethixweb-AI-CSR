# 01 — CSR Behavior Model

## The target, stated plainly

Not "an AI that follows a script." An experienced dispatcher who knows the company's rules,
listens carefully, remembers what the caller already said, answers the question the caller is
asking *right now*, collects only necessary information, and naturally moves the conversation
toward resolution. The caller should feel: *I don't have to repeat myself. She actually listened.
He answered my question. I didn't have to fight the system.*

Every rule elsewhere in this folder is in service of that, not an end in itself.

## The four guiding principles, and where each actually lives in code

### 1. Listen first

Implemented: `PLATFORM_BASE_PROMPT_V1` (v12) — *"When the caller starts explaining why they're
calling, let them finish before asking anything else — starting with address or phone number
questions before they've even explained the problem feels like an interrogation, not a
conversation."*

This is a real, evidence-driven rule: the source CSR training transcript's own most consistent
pattern was letting the caller fully explain before pivoting to logistics.

### 2. Current intent first

A caller's own direct question — pricing, hours, service area, "can I talk to a human," anything
with a real answer available — always outranks whatever the model was itself in the middle of
asking.

Implemented in two layers:
- **Narrow case** (v13): *"If you ask for something and the caller answers a different question
  instead or moves on to something else, don't just repeat the same request again — respond to
  what they actually said first."*
- **General case** (v16): *"A caller's own direct question ... is always the current priority:
  answer it fully before returning to whatever you were in the middle of asking."*

**Evidence this actually works, not just reads well:** a real-model test (`scripts/measure-
conversation-quality.ts`, "v16: current intent first" scenario) confirmed the model calls
`getBusinessHours` and answers a direct "are you open right now?" mid-flow rather than deferring
it — see that file's own git history for the honest caveat (the phrasing right after answering
could be smoother; not chased to a false-perfect result on one run).

### 3. Memory before question

Before asking for anything, the model should already be checking: did the caller just give this?
Is it in the current call's own history? Does a tool result already have it?

This is **not** implemented as a separate structured "slot-filling" state machine — the
conversation's own message history (already passed to the model every turn) and prompt-level
instructions are the mechanism. A full structured-state rewrite was deliberately not built (see
`Known gaps` below) — this project's own standing instruction is "do not rewrite the architecture,"
and the prompt-level approach has real, verified evidence of working for the cases it's been
tested against.

Concrete implementations:
- Multi-word name given together is first+last, never re-asked (base prompt).
- Caller ANI is used for an immediate `searchCustomer` lookup before ever asking for a phone
  number verbally (v16) — **verified against the real model**: `searchCustomer` was called with
  the exact ANI value, unprompted, before any turn asked for it.
- Corrections replace, not append (see `07-correction-and-confirmation-rules.md`).

### 4. Ask one useful question at a time

The base prompt's own conversational-flow rules (v12: paraphrase, don't interrogate) combined with
the emergency-first/qualify-naturally structure mean the model is never instructed to front-load
five fields in one breath. This has not needed a dedicated rule because no live evidence has ever
shown the model doing this — if it's ever observed, add a rule here citing the exact transcript
excerpt (generalized, no PII) that proved it.

## Known gaps

- **Memory-before-question is prompt-level, not a hard architectural guarantee.** A caller-
  specific structured slot-filling state machine (explicit `{name: collected, address:
  pending, ...}` tracked outside the LLM's own context) would be a stronger guarantee but is a
  real architecture change, not a prompt tweak — correctly out of scope per this project's own
  "don't rewrite working architecture" instruction. The current mitigation (v13's "stop asking a
  third time" + v15/v16's close-signal and current-intent rules) has real evidence of reducing,
  not eliminating, repeated-question behavior — see `05-information-collection-rules.md`'s own
  "Known gaps" for the specific case that still fails.
- **"One useful question at a time" has no dedicated real-model regression test.** It hasn't been
  observed failing, so it hasn't earned a targeted rule yet — this is a real absence of evidence,
  not a confirmed pass.
