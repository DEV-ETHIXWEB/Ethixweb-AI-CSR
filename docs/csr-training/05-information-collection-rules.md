# 05 — Information Collection Rules

## Memory before question

The governing principle: before asking for anything, check (1) did the caller already give this
this call, (2) is it already in the conversation's own message history, (3) does a tool result
already have it. Only ask if genuinely still needed.

This is implemented at the **prompt level**, relying on the model's own context window plus
explicit instructions — not a separate structured state tracker. See `01-csr-behavior-model.md`'s
"Known gaps" for why a full state-machine rewrite was deliberately not built.

## Caller ANI → immediate lookup (v16)

The single most concrete, real-model-verified implementation of "memory before question": the
model's own system prompt already contains the caller's phone number (`Caller ANI: +1... →
searchCustomer already run: not yet run`, from `runtime-context.ts`'s `formatRuntimeContext`)
before the first turn even happens. v16 instructs the model to use it:

> "Your own context includes the caller's phone number (Caller ANI) before you ever ask for one —
> when it looks like a real, complete phone number, call searchCustomer with it as one of your
> first actions ... instead of asking the caller to read their number out loud."

**Real-model evidence**: `searchCustomer` was called with the exact ANI value from context,
unprompted, and the matched customer's name was used naturally afterward — see v16's own commit
for the full transcript.

## Multi-word names

Implemented: base prompt — two or more words given together (*"Akash Kumar"*) are accepted as
first+last without a follow-up asking for a last name; a single word (*"Akash"*) does prompt for
the last name, but only once — asking again after both are already given is explicitly named as
"the over-confirming pattern callers find annoying."

## First-name-only must still get followed up before the call ends

Implemented: base prompt — a first-name-only record is explicitly called "an incomplete record";
the rule allows deferring the last-name ask (don't force it into the same breath as a more urgent
question) but requires circling back before close.

## Corrections replace, not append

See `07-correction-and-confirmation-rules.md` for the full rule and real-model evidence (name and
address corrections both held perfectly through every later mention in testing).

## Stop asking after two attempts; close signals count as strong as two redirects

Implemented: v13 (two attempts) + v15/v16 (an explicit close signal — "that sounds good," "that's
everything" — counts as at least as strong as two redirects, so the model doesn't ask a third time
immediately after the caller has signaled they're done).

## Second issue mentioned in passing is a real opportunity, not small talk

Implemented: v12, directly from the training transcript's own most-emphasized pattern — a caller
mentioning a second problem, even briefly, should be treated as something to actively ask about,
not something to let pass.

## A look-and-quote agreement is a qualified opportunity, not a sold job

Implemented: v12 — describe it honestly ("we'll take a look and let you know what it'll cost," not
language implying the work is already arranged), and use `priority: "estimate"` rather than
`"routine"` when calling `createLead`.

## A future, not-yet-actionable project gets noted, not pushed

Implemented: v12 — acknowledge and fold into the problem summary; don't pressure the caller to
commit.

## Known gaps

- No prompt guidance yet on using `lookupPreviousCalls` results to skip re-qualification for a
  caller with call history beyond the current one.
- Email-address collection/spelling-confirmation has no dedicated rule (the base prompt's spelling
  rule is name-specific; see `07-correction-and-confirmation-rules.md`).
- See `04-objection-and-frustration-handling.md` for the honest, currently-open limitation on a
  caller who never answers a genuinely required field (phone number).
