# 02 — Conversation Patterns

## Greeting

Implemented: `DEFAULT_BRAND_VOICE_PROMPT` (tenant layer) + base prompt v14's conditional
self-introduction — *"If you were given a name in your instructions, introduce yourself by it in
your opening greeting ... if you weren't given one, that's fine too — don't invent one."*

Real-model evidence (`checkGreeting()` in `scripts/measure-conversation-quality.ts`): the greeting
reliably introduces Grace by name when a tenant name is configured. **Known gap**: when the
business itself has no real name configured in core-api (this project's own dev environment has
zero rows in the `businesses` table), the greeting falls back to a generic phrase — observed once
in real testing as a literal `"[company name]"` placeholder-looking utterance (not reliably
reproduced across 5 runs; root cause is the missing business-name configuration, not a prompt bug
— see that finding's own commit message for the full trace).

## Acknowledging the actual problem, not a bare "Okay"

Implemented: v12 — *"Once they've explained, paraphrase it back in your own words ('Got it,
so...', 'Just so I understand...', 'If I'm hearing you right...') to confirm you understood, rather
than a bare 'Okay' every time."*

Bad (the pattern this rule exists to prevent):
> Caller: "My water heater's been making this awful banging noise for like three days now,
> and this morning there was no hot water at all."
> CSR: "Okay. What's your address?"

Better (what v12 actually produces, real-model-verified in the "Natural turn-taking" and
"v12: property-manager call" scenarios):
> CSR: "Got it — so it's been banging for a few days and now you're out of hot water entirely.
> That's worth getting looked at soon. What's the address?"

## Real distress gets one short human reaction, not a canned phrase or a long detour

Implemented: base prompt — *"When a caller sounds upset, scared, or is describing active damage
happening right now (water running, a strong smell, something overflowing), briefly acknowledge
that like a person would before moving on to questions — one short human reaction, not a canned
phrase, and not a long detour."*

Real-model evidence (QA mission "urgency and emotion" scenario, active-flooding caller): the model
opens with a brief acknowledgment + a genuinely useful piece of safety advice ("do you have a
shut-off valve you can turn?") before continuing — matching the intended pattern. **Known gap**:
in 1 of 4 repeated real-model runs of the same scenario, a caller's direct follow-up question
("how fast can someone get here?") was not answered at all, just re-deferred to contact-info
collection — not reproducible enough across repeated runs to justify a targeted fix yet (3 of 4
runs handled it correctly, with an honest "can't promise a specific time, but flagging this as
priority" answer); flagged here as a real, if intermittent, risk rather than silently dropped.

## No stock enthusiasm openers

Implemented: base prompt — explicitly names *"Absolutely!", "Certainly!", "Great question!"* as
patterns to avoid, on the reasoning that *"a real CSR reacts to what was actually said, not with a
canned burst of enthusiasm before every single response."*

## Vary phrasing; never repeat a confirmation twice in one response

Implemented: base prompt, direct instruction. No dedicated real-model test currently isolates this
specific claim — it is exercised incidentally by every other scenario's transcript, but has not
been the subject of a targeted pass/fail check.

## Never narrate internal process out loud

Implemented: v14, found from a real (not reliably reproducible) artifact where the model wrote
`"*[Calling escalateEmergency]*"` as literal spoken text in one real-model run — closed even
without full reproducibility, since the cost of a caller hearing a stage direction is high and the
fix (an explicit "don't do this" instruction) is cheap and low-risk.

## Known gaps

- The dev environment's missing business-name configuration is a real, live risk to the greeting's
  polish — this is a *data* gap (core-api has zero business records with real names in this
  environment), not a prompt-layer bug, and belongs on the business-onboarding checklist
  (`docs/42-tenant-onboarding-runbook.md`), not in this prompt.
- No dedicated automated check yet for "never repeats a confirmation twice in one response" as its
  own scoreable criterion — folded into the general quality rubric (`10-csr-quality-rubric.md`)
  rather than tested in isolation.
