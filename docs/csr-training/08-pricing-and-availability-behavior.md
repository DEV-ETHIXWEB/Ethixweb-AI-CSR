# 08 — Pricing and Availability Behavior

## The load-bearing boundary: never a specific price, never a specific appointment time

Implemented: base prompt, the very first substantive sentence — *"You qualify leads; you never
schedule, promise a specific appointment time, or quote a price."*

This is a **deliberate product boundary**, not an oversight to eventually fix. The reasoning,
stated directly in this prompt file's own v12 comment: the real CSR training transcript this
project drew from *does* have the human CSR offering a specific window ("tomorrow morning, 8 to
10") — that specific behavior was explicitly **not** adopted, because this platform has no real
scheduling-availability integration to check against. Promising a window it can't back up would be
exactly the kind of overclaim the honesty rules elsewhere in this prompt (v6, v8) exist to prevent.
Do not "fix" this by making the model more willing to give times/prices without first building the
real availability/pricing integration underneath it — that would trade a caller-experience polish
for a trust-breaking overclaim.

## Direct pricing questions still get answered — honestly, within the boundary

**Real-model evidence**: "QA mission Phase 9: topic change and return" — asked directly "how much
do you typically charge for a diagnostic visit," the model declined to give a number but offered a
concrete next step (a team member/technician visit) rather than stonewalling or ignoring the
question.

## A look-and-quote agreement is a real opportunity, tracked correctly

See `05-information-collection-rules.md` — `priority: "estimate"`, described honestly as
not-yet-committed work.

## Business hours — answer directly, using the real tool

Implemented: v16, generalizing the topic-change rule to explicitly include hours. `getBusinessHours`
exists and returns a real answer; the model is instructed to use it and answer directly rather than
deferring a direct "are you open?" question.

**Real-model evidence**: v16's "current intent first" scenario confirms the tool gets called and
the question gets answered (see `06-topic-change-rules.md` for the honest phrasing caveat).

## Service area — a nice-to-have check, never a gate on helping someone

Implemented: v15, found live after v14/v15's own address-schema fix moved the model's fixation from
"street address" to "zip code for service-area checking" — *"Checking whether an address is in
your service area is a nice-to-have, never a prerequisite for helping someone — create the
customer and the lead with whatever contact info you actually have."*

This is a genuinely important lesson for anyone extending this system: fixing one blocking-field
bug can surface an identical bug shape one field over, because the underlying cause (the model
self-imposing "I need X before I can help") isn't tied to any single field. Any new required-ish
check added to this system should be reviewed against this same risk.

## Known gaps

- No availability/scheduling integration exists at all — this is a real, acknowledged platform
  limitation, not something this prompt-layer pass could or should fix.
- After-hours behavior specifically (as opposed to "are you open right now" during business hours)
  has no dedicated real-model test.
