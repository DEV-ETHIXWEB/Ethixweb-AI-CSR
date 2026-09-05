# All Phase Plumbing — Knowledge Base

Structured, source-verified facts about All Phase Plumbing (allphaseplumbing.com),
crawled live and extracted into the existing `core-api` Knowledge module
(`docs/38`, `apps/core-api/src/modules/knowledge/`) — NOT a new/parallel
knowledge system. This directory is the human-readable audit trail; the
facts it documents are seeded into real `KnowledgeItem` rows (category,
title, content, `aiKnowledge: true`, `status: approved`) by
`apps/core-api/scripts/seed-all-phase-knowledge.ts`, which
`HttpAgentProfileProvider` (voice-orchestrator) already fetches on every
real call and folds into the BUSINESS OVERRIDE layer of the system prompt
(docs/03 §1) — this wiring existed and was tested before this work; the
`knowledge_items` table was simply empty (0 rows) until now.

## Crawl date and source precedence

Every fact below was fetched LIVE from allphaseplumbing.com on
**2026-09-05**. That date is the authority, not any prior secondhand
citation of the site (including ones quoted to Claude by a user from an
external source) — a live re-check during this same work found the site's
founding-year claim ("Since 1989") consistent across the homepage, /about,
and the emergency-plumber page, and found the live coupons page currently
listing offers that expire **10/31/2026**, not the expired 04/30/2025 offer
an earlier secondhand citation described. Whenever this file and a fresher
crawl disagree, the fresher crawl wins — re-verify before trusting anything
here past a few months old, and especially re-check `05-promotions.md`
before 10/31/2026.

## No PII, no fabricated facts

Every fact here traces to a specific, live, public page on
allphaseplumbing.com — nothing is invented, and nothing here is customer
data (matches the no-PII discipline already established in
`docs/csr-training/00-README.md`).

## What deliberately was NOT crawled

allphaseplumbing.com has ~30 individual service sub-pages (faucet
installation, shower installation, backflow testing, septic tank service,
etc.) beyond the ones documented here. The ~10 categories covered in
`03-services.md` were chosen because they're the highest-frequency real
caller topics (confirmed against the real ~10-minute call transcript
analyzed alongside this work — the caller's stated problem was an AC issue,
outside this business's actual trade, which is itself a reminder that
callers ask about things a plumbing knowledge base can't and shouldn't
guess at). Grace's own prompt already instructs her not to guess at
anything unpublished — a caller asking about a service not listed here
should get an honest "let me have someone confirm the specifics," not an
invented answer. Extending coverage to the remaining pages is a
straightforward re-run of the same crawl-and-seed process, not an
architecture change.

## Files

- `01-company.md` — identity, licensing, hours, pricing philosophy, warranty, contact
- `02-emergency.md` — emergency definitions, customer safety instructions, gas-leak safety (highest severity — kept separate from general emergency facts)
- `03-services.md` — the ~10 highest-frequency service categories
- `04-service-areas.md` — cities/counties served, coverage disclaimer
- `05-promotions.md` — current coupons, with real expiration dates — re-verify before 10/31/2026, never let an item past its expiration stay `aiKnowledge`-active
