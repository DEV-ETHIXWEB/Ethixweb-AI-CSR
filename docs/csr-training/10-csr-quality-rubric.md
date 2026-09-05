# 10 — CSR Quality Rubric

## How to use this

Run `pnpm exec ts-node -T scripts/measure-conversation-quality.ts` from `apps/voice-orchestrator`
(needs a real `ANTHROPIC_API_KEY` — it refuses to run without one rather than fabricate a
transcript, see that script's own top-of-file comment). Read the printed transcript against the
15 criteria below. **This script does not auto-grade** — it prints real model output for human
inspection. Do not treat "the script ran and printed something" as a pass; read the actual words.

This is a scoring guide, not a pass/fail gate baked into CI — conversational quality has enough
genuine judgment calls (is this acknowledgment natural enough? is this the right amount of
empathy?) that automating the grading itself would trade real signal for false precision. Where a
criterion below CAN be checked mechanically (a fact, not a judgment call — e.g. "did the tool
result's name appear in the response text"), that mechanical check belongs as an assertion in
`prompt-layers.spec.ts` or a dedicated test, not just this rubric.

## The 15 criteria

1. **Did the CSR answer the customer's actual question?** Not "did it eventually get there" — did
   the very next relevant response address what was just asked, per `06-topic-change-rules.md`.
2. **Did the CSR acknowledge the actual problem?** A specific paraphrase, not a bare "Okay" — per
   `02-conversation-patterns.md`.
3. **Did the CSR remember previously provided information?** Check every later mention of a
   name/address/detail against what was actually given, including after a correction — per
   `07-correction-and-confirmation-rules.md`.
4. **Did the CSR avoid unnecessary questions?** Especially: did it re-ask anything already given,
   or anything derivable from the Caller ANI lookup — per `05-information-collection-rules.md`.
5. **Did the CSR ask only the next useful question?** Not a five-question dump.
6. **Did the CSR handle corrections?** Old value never resurfaces after a correction.
7. **Did the CSR handle interruptions/topic changes?** Answered the interrupting question, then
   returned to the original topic without restarting — per `06-topic-change-rules.md`.
8. **Did the CSR handle "hello? / are you still there?"** Immediate, direct acknowledgment, never
   silence, never a bare repeat of the previous question — per v16.
9. **Did the CSR handle frustration?** Owned an "I already told you" moment briefly, without
   over-apologizing or getting defensive — per `04-objection-and-frustration-handling.md`.
10. **Did the CSR avoid hallucinations?** No invented price, no invented availability, no invented
    tool result, no invented technical claim it wasn't confident about (v14's technical-question
    deferral rule).
11. **Did the CSR use tools correctly?** Right tool, right arguments, `escalateEmergency` called
    unconditionally and early, `priority` reflecting its result — per `09-emergency-and-escalation-
    behavior.md`.
12. **Did the CSR avoid claiming unavailable information as fact?** Distinct from #10 — this is
    specifically about the honesty rules (never claim `createLead` succeeded before it actually
    did, never claim to be human when seriously asked).
13. **Did the CSR sound natural?** No stock enthusiasm openers, no repeated confirmations in one
    response, contractions, varied phrasing — per `02-conversation-patterns.md`.
14. **Did the CSR close appropriately?** Recognized a close signal and wrapped up rather than
    re-asking an outstanding, non-critical field — per v15/v16.
15. **Was there no unexplained long silence?** This one is **not** judged from the transcript text
    alone — it requires the actual turn-timing evidence (voice-runtime/voice-orchestrator
    structured logs, or the latency instrumentation already built into `handle-turn.use-case.ts`'s
    own `timeToFirstChunkMs`/`totalMs` logging). A transcript with perfect words but 8 seconds of
    dead air before each one is not a pass.

## Honest status as of this writing (v16)

This is not a claim that every criterion is fully solved — it's the actual, evidenced state:

| # | Criterion | Status |
|---|---|---|
| 1 | Answers direct questions | Real-model-verified for pricing, hours; not tested for fully unrelated questions |
| 2 | Acknowledges problem | Real-model-verified |
| 3 | Remembers/corrections | Real-model-verified, strong evidence (name + address corrections both held perfectly) |
| 4 | Avoids unnecessary questions | Real-model-verified for ANI lookup; open gap for the fully-general "never answers a required field" case |
| 5 | One question at a time | No dedicated failing evidence, but also no dedicated targeted test |
| 6 | Handles corrections | Real-model-verified, strong evidence |
| 7 | Interruptions/topic changes | Real-model-verified |
| 8 | "Hello? Are you there?" | Real-model-verified, decent baseline even before v16 named it explicitly |
| 9 | Frustration ("already told you") | Real-model-verified, exact intended phrasing reproduced |
| 10 | No hallucinations | No dedicated adversarial test yet designed to try to induce one |
| 11 | Tool correctness | Real-model-verified across many scenarios |
| 12 | Honesty | Real-model-verified (v6/v8 rules), no recent adversarial retest |
| 13 | Natural sounding | Real-model-verified, qualitative judgment call each time |
| 14 | Closes appropriately | Real-model-verified for the specific "close signal after redirect" case |
| 15 | No unexplained silence | Verified for the two P0 bugs found and fixed this session (singleton-scope bug, over-aggressive barge-in) — not a standing guarantee for every possible cause of delay |

**Do not say "production ready" from this table alone.** It documents what has been tested and
what hasn't — the actual production-readiness call also depends on real-phone verification
(`docs/31-first-real-phone-call-runbook.md`), which this table does not substitute for.
