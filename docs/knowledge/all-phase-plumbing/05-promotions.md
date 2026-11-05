# Promotion Facts — expiration-sensitive, re-verify before 12/31/2026

Crawled live 2026-09-05 from https://www.allphaseplumbing.com/coupons.
All three current offers share the same expiration date and the same
eligibility restrictions.

## 2026-11-05 — STILL ACTIVE. The printed date is stale, not the offers.

The coupons page was re-fetched on 2026-11-05 and still displays
"EXPIRES 10/31/2026" on all three, with no replacements. On the face of it
that means the CSR had been offering dead discounts for five days.

It had not. Akash confirmed on 2026-11-05 that the client has these
running **through December 2026**; the website simply has not been
updated. So the stale value is on the public page, and the offers
themselves are good.

Two things follow, and they point in opposite directions, so do not
collapse them:

1. **Do NOT disable these rows.** The 10/31/2026 date printed on the page
   is wrong, and the re-verify instruction below would otherwise tell the
   next reader to switch off three offers the business is actively running.
2. **The exact end date is still unconfirmed.** "Through December" was
   given verbally, not from a document. Treat 12/31/2026 as a working
   assumption to re-check, not as a verified fact, and get the real date
   before trusting these past the end of the year.

Worth raising with the client separately: their own customers read that
page, see 10/31/2026, and conclude the offers have ended.

FACT: $100 off drain cleaning, includes a free camera inspection of the mainline sewer. Residential homeowners only, one per household, must be shown at time of service, not valid with other offers. Page prints 10/31/2026; actually runs through December 2026.
SOURCE URL: https://www.allphaseplumbing.com/coupons
VERIFIED: 2026-09-05; still active per Akash 2026-11-05 (runs through December 2026, exact date unconfirmed) | STATUS: approved

FACT: 10% off the next residential plumbing service call, capped at $250. Same restrictions as above. Page prints 10/31/2026; actually runs through December 2026.
SOURCE URL: https://www.allphaseplumbing.com/coupons
VERIFIED: 2026-09-05; still active per Akash 2026-11-05 | STATUS: approved

FACT: $250 off any residential water heater (install/replacement). Same restrictions as above. Page prints 10/31/2026; actually runs through December 2026.
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
