# CSR Training / Behavior System

## What this actually is

This directory documents Grace's (the AI CSR) behavior model as it is **actually implemented** in
`apps/voice-orchestrator/src/modules/prompt/domain/prompt-layers.ts` (`PLATFORM_BASE_PROMPT_V1`,
currently version v16) — not an aspirational spec written independently of the code. Every rule
described here traces to a specific, real prompt instruction, a real tool-schema decision, or a
real, reproduced finding from an actual call (this session's own live test calls, plus one real
CSR-training reference transcript). Where a rule is a currently-open gap rather than an implemented
behavior, that is stated explicitly — this system does not claim more than the evidence supports.

## Where the evidence actually comes from — read this before trusting anything else in this folder

Two, and only two, real sources of "how a good CSR handles a call" exist for this project:

1. **One real, human CSR training transcript** (a property-manager call reporting a washer-drain
   backup — referred to elsewhere in this codebase as "the Lisa call" / "the v12 training material").
   It was supplied as text, not as a file, and its generalizable lessons were extracted directly
   into `prompt-layers.ts` v12 (see that file's own version-history comment) — this document
   restates and organizes those lessons, it does not add new ones from thin air.
2. **This project's own real, live test calls** — reconstructed from `voice-runtime`/
   `voice-orchestrator` structured logs (caller transcripts, turn timing, tool calls, error paths)
   during this session's debugging and QA passes. Grace's own spoken text is **not** persisted
   anywhere (a deliberate design choice — see `handle-turn.use-case.ts`'s own comment on why only
   `textLength` is logged, not the text itself), so "what Grace said" evidence comes from
   `scripts/measure-conversation-quality.ts` runs against the real Anthropic API, not from
   production logs.

**There is no larger corpus of historical human-CSR transcripts anywhere in this repository or
this project's files.** A prior mission brief assumed one existed; a full-repo and filesystem
search turned up nothing beyond the single document in (1). If real historical call recordings or
transcripts from the actual business become available, they should replace the illustrative
examples in `03-common-customer-scenarios.md` with real (PII-scrubbed) evidence — until then, that
file's examples are clearly marked as illustrative, not verbatim.

## No PII, ever

Nothing in this folder — and nothing that should ever be added to `prompt-layers.ts` or any other
runtime prompt — contains a real caller's name, phone number, address, email, or any other
identifying detail. Every example below uses a generic placeholder name/detail invented for
illustration. This is not a style preference; it is a hard rule (see `05-information-collection-
rules.md`'s own note on why historical transcripts are behavioral evidence, never runtime data).

## How to use these files

- **Building/reviewing a prompt change?** Start with `01-csr-behavior-model.md` for the guiding
  principles, then the specific topic file for the exact rule and its evidence.
- **Testing a change?** `10-csr-quality-rubric.md` is the scoring guide; run it against
  `scripts/measure-conversation-quality.ts` output, not against unit tests alone (mocked providers
  cannot answer behavioral questions — see that script's own comment).
- **Looking for what's still broken?** Every file ends with a "Known gaps" section, honestly
  listing what evidence exists that a rule is incomplete, not just what the rule says.

## File index

| File | Covers |
|---|---|
| `01-csr-behavior-model.md` | The guiding principles: listen first, current-intent-first, memory-before-question |
| `02-conversation-patterns.md` | Greeting, acknowledgment, paraphrasing, one-question-at-a-time |
| `03-common-customer-scenarios.md` | Scenario-by-scenario: what the system does today, with evidence |
| `04-objection-and-frustration-handling.md` | Frustration, emotion, "I already told you" |
| `05-information-collection-rules.md` | Memory-before-question, ANI lookup, corrections, when to stop asking |
| `06-topic-change-rules.md` | Current-intent-first, problem↔pricing↔problem, real-model evidence |
| `07-correction-and-confirmation-rules.md` | Name/address corrections, spelling confirmation |
| `08-pricing-and-availability-behavior.md` | Never-quote-a-price, estimates, hours, service area |
| `09-emergency-and-escalation-behavior.md` | escalateEmergency, human transfer, honesty rules |
| `10-csr-quality-rubric.md` | The scoring rubric and how to apply it with the real-model harness |
