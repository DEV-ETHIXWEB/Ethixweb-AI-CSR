# Promotion Facts — expiration-sensitive, re-verify before 10/31/2026

Crawled live 2026-09-05 from https://www.allphaseplumbing.com/coupons.
All three current offers share the same expiration date and the same
eligibility restrictions.

FACT: $100 off drain cleaning, includes a free camera inspection of the mainline sewer. Residential homeowners only, one per household, must be shown at time of service, not valid with other offers. Expires 10/31/2026.
SOURCE URL: https://www.allphaseplumbing.com/coupons
VERIFIED: 2026-09-05 | STATUS: approved (currently active — 2026-09-05 is well before the 10/31/2026 expiration)

FACT: 10% off the next residential plumbing service call, capped at $250. Same restrictions as above. Expires 10/31/2026.
SOURCE URL: https://www.allphaseplumbing.com/coupons
VERIFIED: 2026-09-05 | STATUS: approved (currently active)

FACT: $250 off any residential water heater (install/replacement). Same restrictions as above. Expires 10/31/2026.
SOURCE URL: https://www.allphaseplumbing.com/coupons
VERIFIED: 2026-09-05 | STATUS: approved (currently active)

## Expiration handling — this is the critical part

An earlier secondhand citation of this site (quoted to Claude, not
independently verified at the time) claimed the live coupons page listed
an offer that had already expired 04/30/2025. A fresh live crawl on
2026-09-05, done specifically to check this, found no such offer — the
three coupons above, all expiring 10/31/2026, are what's actually live.
That citation was either stale or already wrong; it was not taken on
faith, it was re-verified.

**The actual lesson to keep applying going forward**: whoever re-runs this
crawl after 10/31/2026 (a future Claude session or a human) MUST check the
live coupons page again before trusting these three facts. None of these
KnowledgeItem rows should be left `status: approved` with `aiKnowledge: true`
past their stated expiration — disable or update them at that point. There
is no code-level expiration enforcement in the current `KnowledgeItem`
schema (no `expiresAt` column — see `apps/core-api/src/modules/knowledge/domain/knowledge-item.entity.ts`),
so this is a manual/process safeguard, not an automatic one. Adding a real
`expiresAt` column with enforcement would be a reasonable follow-up if this
business accumulates more time-boxed offers, but wasn't built here — it
would be new schema/architecture for three coupons with 8 weeks of runway
at time of writing, which the "don't over-engineer" instruction this work
was done under weighs against.
