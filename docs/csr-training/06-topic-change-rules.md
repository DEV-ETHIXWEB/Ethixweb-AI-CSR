# 06 — Topic Change Rules

## The principle: the caller controls the conversation

A caller moving between topics — problem → pricing → problem, problem → hours → problem, problem →
unrelated question → problem — should never be forced back into a rigid questionnaire. The model
answers the caller's actual current question, then naturally returns to what it was doing.

## Narrow case: a different field than the one asked for

Implemented: v13 — _"If you ask for something and the caller answers a different question instead
or moves on to something else, don't just repeat the same request again — respond to what they
actually said first."_

**Real-model evidence**: the "Natural turn-taking / backchannel" scenario (caller answers a
zip-code-coverage question mid-flow, unprompted) and the "v12: property-manager call" scenario
(caller adds a second/third issue, a future project, a tenant point-of-contact, all handled without
forcing a restart) both confirm this works in practice, not just in prompt text.

## General case: any direct question outranks the model's own agenda

Implemented: v16 — generalizes the above from "a different field" to "any direct question with a
real answer" (business hours, service area, pricing information the model has, "can I talk to a
human").

**Real-model evidence**: "v16: current intent first" — a direct "are you open right now?" mid-flow
gets `getBusinessHours` called and answered, not deferred. Honest caveat: the phrasing
immediately after answering was a little rushed in the observed run ("Yeah, we're still open. What's
your phone number?" — answered, but tacked onto the very next sentence rather than given its own
beat) — a real, minor polish gap, not a correctness failure.

## Worked example (illustrative, not a real transcript)

> Caller: "My water heater isn't working."
> CSR: "I can help with that. Is it completely cold, or are you getting some hot water?"
> Caller: "Before that — how much do you charge for a diagnostic visit?"
> CSR: [answers the pricing question honestly, per `08-pricing-and-availability-behavior.md`]
> CSR: "And coming back to the water heater — is it gas or electric?"

This exact shape (pricing interruption, then clean return to the original topic) was
real-model-verified in the "QA mission Phase 9: topic change and return" scenario — the model
declined to quote a specific price (correctly, per the platform's own never-quote-a-price rule),
offered a technician visit instead, then resumed the AC/water-heater issue without restarting or
re-asking anything already covered.

## Emergency overrides topic-following

Unlike an ordinary topic change, an emergency does not wait for the caller to bring it up in a
natural pause — `escalateEmergency` is called unconditionally as soon as the problem is described,
before any further qualifying questions of any kind. See `09-emergency-and-escalation-behavior.md`.

## Known gaps

- Genuinely unrelated (non-business) questions are not yet real-model-tested — only in-domain
  topic changes (pricing, hours, service area, a second issue) have direct evidence.
- The "return to the original topic" half of the pattern has only been verified for a small number
  of scenarios; it has not been stress-tested with multiple interleaved topic changes in one call.
