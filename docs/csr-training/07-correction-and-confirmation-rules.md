# 07 — Correction and Confirmation Rules

## Corrections replace, not append

No caller correction (name, address, phone, anything else) should ever result in the model holding
both the old and new value, or reverting to the old one later in the call.

**Real-model evidence, the strongest in this whole folder**: two dedicated scenarios
(`scripts/measure-conversation-quality.ts`, "QA mission Phase 6: name correction" and "... address
correction") gave the model an initial value, then an explicit correction, then asked for a recap
several turns later. Both held perfectly — every later mention, and the tool-call-adjacent recap,
used the corrected value with zero reversion to the original.

## Spelling confirmation is conditional, not automatic

Implemented: base prompt — *"Only spell a name back letter by letter when it's genuinely uncommon
or foreign-sounding, or when the transcript is flagged as low-confidence — an ordinary name like
'John Miller' needs no spelling confirmation at all; asking for one anyway is exactly the
over-confirming pattern callers already find annoying elsewhere, and asking twice is worse."*

This rule exists specifically because the opposite (always spell-confirming) is a documented
real-world anti-pattern from a comparable CRM-integration finding referenced in this same prompt
file's own version history (docs/03 §5).

## Address confirmation is folded into the recap, not a separate step

Implemented: base prompt — *"Always confirm the address back once, folded into the same breath as
the rest of your recap, not as a separate follow-up question."*

## Low-confidence STT is a signal for the model, not the caller

`sttConfidence` is threaded into the message the model sees (see `handle-turn.use-case.ts`'s own
`LOW_STT_CONFIDENCE_THRESHOLD`) — the model is told when a transcript may have been misheard, and
the base prompt's spelling-confirmation rule is conditioned partly on this flag. This is a real,
structural signal, not a prompt-only guess.

## Known gaps

- Email-address spelling/confirmation has no dedicated rule — the existing rule is worded around
  names specifically. Given email addresses are inherently harder to get right by ear (dashes,
  numbers, uncommon domains), this is a real, plausible gap worth a targeted rule if/when a real
  call surfaces it as an actual problem — not preemptively added without evidence, per this
  project's own "don't add giant prompt instructions for problems caused by code, and don't add
  unproven fixes" discipline.
- Phone-number correction (as opposed to name/address) has no dedicated real-model test, though the
  same underlying mechanism (conversation history + correction-handling instructions) should apply
  equally — flagged as untested, not assumed to work by analogy alone.
- Zip-code correction has no dedicated test.
