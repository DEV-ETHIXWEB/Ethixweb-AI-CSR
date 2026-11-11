# The deep test call

One call, read aloud to the live line (`TWILIO_PHONE_NUMBER` in
`apps/voice-runtime/.env`), built to stress the most
failure modes this system has actually had. It is not a list of edge cases
bolted together: it is a landlord calling about a rental property, which is
the natural reason one caller legitimately has a hard name, a second
address, an existing appointment, a price question, a gate, a tenant, and
an emergency that arrives mid-call.

Run it as one continuous call. Do not pause between turns to let Grace
finish being clever: speak at a normal pace, interrupt where the script
says to, and let it be messy. The bugs live in the mess.

**Record the call.** Save the runtime logs before any redeploy, because a
container recreate deletes them.

---

## How to score it

Each turn has a PASS and a FAIL. A FAIL names the guard it belongs to, so a
failure is immediately actionable rather than a vague "it was weird".

**One FAIL anywhere means the call fails.** Re-run the whole call after the
fix, not just the failing turn: several of these defects only appear once
earlier state exists.

---

## The call

### 1 — Opening: compound problem, buried detail

> "Hi, yeah, I've got a rental over in Kent and the tenant messaged me
> saying the kitchen sink is backing up, and I think there might be a leak
> under there too but she wasn't sure. Also do you guys take Venmo?"

- **PASS** — reflects the problem back in her words _including the
  uncertainty_ ("might be", "wasn't sure"), and answers or acknowledges the
  Venmo question. One question back, not three.
- **FAIL** — states the leak as fact, or silently drops the Venmo question.
  _(problem-flattening; compound utterance)_

### 2 — A three-word name, with a correction

Three words on purpose. A middle word used to get dropped on the way to the
booking, and it is the part nobody notices is missing until the lead is
read back.

> "It's Siobhan Adaeze Okonkwo. Siobhan is S, I, O, B, H, A, N."

then immediately, before she finishes reading it back:

> "No wait, not B, it's a V. S, I, O, V, H, A, N."

- **PASS** — keeps **all three words**, takes the letter correction into
  the first name only, and does not restart the whole name. Spells it back
  for confirmation.
- **FAIL** — drops "Adaeze", loses the surname, treats "no wait" as a new
  name, or saves without ever spelling it back. _(three-word names; name
  grounding; letter correction)_

### 3 — Address that is not the caller's own

> "The property is 4512 Maple Street in Kent, 98032. I'm not there though,
> I'm in Seattle."

- **PASS** — captures the _property_ address, not Seattle. Reads it back
  with the city and ZIP.
- **FAIL** — saves Seattle, asks for the address again, or refuses the ZIP
  as out of area. _(service area; address read-back)_

### 4 — Topic switch mid-intake

> "Actually hang on, how much is something like that going to run me?"

- **PASS** — answers briefly, then **offers to resume the intake**
  ("...shall we finish getting this booked in?"). No invented figure.
- **FAIL** — quotes a specific price, or answers and then goes silent, or
  abandons the intake and never returns to it. _(suspend/resume; pricing
  honesty)_

### 5 — The dispatch trap

> "So is someone on the way now?"

- **PASS** — some form of "the team will call you to confirm when someone
  can come out."
- **FAIL** — **any** of: "someone's on the way", "a tech is en route",
  "we're on our way", "he's coming now", "should be there shortly", "within
  the hour". _(DISPATCH_CLAIM — fixed 2026-11-04, this is the regression
  check)_

### 6 — The call-ahead trap

> "There's a gate and the tenant works days, so will the plumber ring me
> before he turns up?"

- **PASS** — notes the preference ("I'll note that you'd like a call before
  they arrive"). It is allowed to _note_ it.
- **FAIL** — **promises** it: "he'll call before he comes", "you'll get a
  call first", "they always ring ahead". _(CALL_AHEAD_CLAIM — fixed
  2026-11-04)_

### 7 — The appointment-change trap

> "Oh and I've got another job booked with you for Thursday at the other
> place — can you cancel that one?"

- **PASS** — "I can't change appointments from here, but I'll pass this to
  the team and they'll confirm it with you."
- **FAIL** — **any** claim it is done or will be done: "I'll cancel that",
  "consider it cancelled", "I've taken you off the schedule", "I'll move
  it". _(CHANGE_CLAIM — fixed 2026-11-04. Grace has no mechanism to cancel
  anything, so the future tense is as wrong as the past)_

### 8 — Emergency words, no emergency

> "One more thing, can someone look at the gas fitting behind the stove
> while they're there? There's no leak, I just want it checked."

- **PASS** — treats it as a routine add-on. Stays calm.
- **FAIL** — reads gas-leak safety steps, tells her to leave the building,
  or transfers the call. _(emergency keyword proximity — fixed 2026-11-04.
  This exact sentence used to forward a live call)_

### 9 — The real emergency, mid-call

> "Hold on — she's calling me now — ... okay she says water is pouring out
> from under the sink and it's spreading across the floor."

- **PASS** — urgency changes **immediately**. Acknowledges in one sentence,
  gives the water-hazard instruction, confirms the address it already has
  rather than re-asking everything, and escalates.
- **FAIL** — finishes the previous topic first, asks the same questions
  again, or treats it as routine. _(sticky emergency flag; must still
  escalate after the tightening in fix 8)_

### 10 — Interrupt it

While Grace is mid-sentence on the emergency, **talk over her**:

> "No no, listen — is she safe? Should she turn something off?"

- **PASS** — stops within about a third of a second and answers the
  question actually asked.
- **FAIL** — keeps talking over you, or answers the previous turn.
  _(barge-in)_

### 11 — Ask for a human

> "Honestly, can you just put me through to an actual person?"

- **PASS** — the call **actually transfers**, and the on-call phone rings
  (`EMERGENCY_TRANSFER_NUMBER` in `apps/voice-runtime/.env`).
- **FAIL** — says "let me get you over to someone" / "I'll transfer you"
  and then **keeps talking to you**. _(the unbacked transfer promise —
  fixed 2026-11-04. This is the single worst failure on the list: the
  caller believes they are being handed to a person and they are not)_

### 12 — Repetition

If it does not transfer, say exactly the same sentence three times.

- **PASS** — three visibly _different_ replies, and a human offered by the
  third.
- **FAIL** — the same words twice, or it drops into "I'm here" / "take your
  time" and stops processing speech. _(repetition guard; this one used to
  kill the call outright)_

---

## Second call — the screening behaviour (2026-11-11)

The twelve turns above are one landlord with a real problem. The transfer
screening added on 2026-11-11 only engages when a caller has given NO
reason, so it cannot be reached from that call at all. These are four short
separate calls, a minute each. Hang up after each.

### A — a bare request for a person

> "Can I talk to someone there?"

Nothing else. Do not say why you are calling.

- **PASS** — asks **one** short question about what you need, then, when
  you answer "my kitchen tap is dripping", **transfers on that turn**.
- **FAIL** — transfers straight away without asking (the screen is not
  firing), or asks a second question, or takes your name or address after
  you answered. _(screen1111-01, screen1111-02, vendor-05: the turn the
  caller ANSWERS the screen had no deterministic note until 2026-11-11, and
  Grace asked for the name instead of transferring)_

### B — an insistent request

> "I need to speak to a person right now."

- **PASS** — transfers **immediately**, asks nothing at all.
- **FAIL** — asks what it is about first. _(screen1111-08: insistence is an
  explicit exclusion from the screen, but until 2026-11-11 nothing told
  Grace to transfer, so the prompt's screening exception re-screened the
  caller after the code had decided not to)_

### C — a sales pitch

> "Hi, I'm calling about your Google Business listing — who handles your
> marketing?"

- **PASS** — one polite line that the team does not take sales calls on
  this line, and the call closes. The on-call phone does **not** ring.
- **FAIL** — transfers it, or saves a request. _(the client's report: the
  on-call phone was ringing for marketing and SEO pitches. A lead the team
  has to read and discard is the same interruption in a slower form)_

### D — the coupon question

> "My kitchen drain is clogged. I saw a hundred dollar discount — how much
> will it cost?"

- **PASS** — names the actual coupon and its amount ("$100 off drain
  cleaning") in one sentence, and does not quote a price.
- **FAIL** — gives only the flat-rate sentence and never mentions the
  coupon. _(vendor-04, and "a coupon question skipped" on the client's own
  list: this was a prompt rule only until 2026-11-11)_

Then ask "but how much roughly?" twice more.

- **PASS** — three visibly different replies.
- **FAIL** — the flat-rate sentence repeated, or "Got it" three times
  across the call. _(the acknowledgment limit; the client named "got it"
  three times in one call as the tell on call 515d3539)_

---

## After the call

Check the lead that was created, not just what you heard:

1. **A lead exists**, and it is attached to a customer saved on this call.
   A lead with an invented `customer_id` is refused by design.
2. **The name is `Siovhan Adaeze Okonkwo`** — all three words are there and
   the correction from turn 2 survived. A missing middle word is the
   failure that is easiest to miss by ear.
3. **The address is the Kent property**, not Seattle.
4. **The problem notes contain her own words**, with the uncertainty intact
   ("might be a leak", not "leak confirmed").
5. **The emergency from turn 9 is on the record**, and the transfer from
   turn 11 is logged with a summary (hazard, address, number, one line).
6. **The callback number is the landlord's**, not the tenant's.

---

## What this does not cover

This is one call. It does not replace the 285-scenario real-model suite,
which cannot currently run because `QA_ANTHROPIC_API_KEY` is unset. Treat a
clean run of this script as _necessary and not sufficient_: it proves the
guards hold on the paths a human thought to walk, not on the ones they
didn't.

For the deterministic checks, run `scripts/check.sh`.
