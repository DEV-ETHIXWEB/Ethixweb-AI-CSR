# 38 — Knowledge & Voice Content

As-built documentation for `apps/core-api/src/modules/knowledge` — the tenant-owned source of truth for what the AI may know and what it may say while a caller is genuinely waiting (docs/36). Replaces the empty, static brochure stub `StaticCapacityConfigProvider` previously returned for every tenant.

## 1. The model

`KnowledgeItem` (Prisma, tenant/business-scoped, RLS-protected):

| Field                                                                  | Purpose                                                                        |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `category`, `title`, `content`                                         | The actual knowledge — free text, entirely tenant-authored, never AI-generated |
| `status`                                                               | `draft` \| `approved` \| `disabled` — see §2                                   |
| `aiKnowledge`                                                          | Independent flag: may the AI reference this during a conversation              |
| `waitingBrochure`                                                      | Independent flag: may this become a rotated waiting-experience segment         |
| `priority`                                                             | Rotation/display order (lower sorts first)                                     |
| `createdByUserId`, `updatedByUserId`, `approvedByUserId`, `approvedAt` | Attribution                                                                    |

`status` is a plain `String` column, not a Prisma `enum` — matching this schema's own stated convention (see `schema.prisma`'s Enums header comment): a new enum is reserved for fields whose value set is backed by a pre-existing, cited architecture doc/ADR (like `LeadStatus`). DRAFT/APPROVED/DISABLED is a design decision introduced in this same change, so it follows the `Business.status`/`Notification.status` precedent instead.

## 2. `aiKnowledge` and `waitingBrochure` are genuinely independent

These are two separate boolean columns, not one derived from the other. A single item can be:

- AI-usable only (internal operational context the AI should know but should never say verbatim while a caller waits).
- Brochure-usable only (a promotional line that's fine as filler but not something the AI needs as conversational context).
- Both.
- Neither (while still in draft, or deliberately scoped narrowly).

No code path derives one flag from the other — confirmed directly in `PrismaKnowledgeRepository`: both flags are independent columns in every `create`/`updateFields`/`listByBusiness`/`listApprovedForRuntime` query, filtered separately.

## 3. The lifecycle — and why `approved → draft` is deliberately forbidden

```
draft ──approve──> approved ──disable──> disabled ──(reopen)──> draft
  └──────────────disable─────────────────┘
```

`assertValidKnowledgeStatusTransition` (`domain/knowledge-lifecycle.ts`) enforces this as an explicit whitelist — unlike `calls/domain/call-lifecycle.ts`'s same-state no-op shortcut, **same-state transitions here throw**: approving an already-approved item, or disabling an already-disabled one, is a real error, not silently accepted. This was a specific design requirement, not an oversight.

`approved → draft` as a general, directly-requestable transition is **intentionally not allowed**. Reasoning (from the code's own comment): allowing a caller to move an approved item straight back to draft with no content change at all would be an ambiguous, hard-to-audit action — indistinguishable in the audit log from the real, legitimate auto-revert (§4). Reopening an approved item requires two explicit steps (`disable`, then the already-valid `disabled → draft`), so every status change is either a machine-triggered side effect of a genuine content edit, or an explicit, unambiguous human action — never an unexplained direct status flip.

## 4. The safety property: editing approved content reverts it to draft

`UpdateKnowledgeItemUseCase` compares the incoming `content` against the existing row's actual value (`patch.content !== existing.content` — not merely "content was present in the patch"; resubmitting the identical text does not trigger a revert). If the item is currently `approved` **and** the content genuinely changed, the write forces `status: "draft"` in the same update. Editing non-content fields (`category`, `aiKnowledge`, `waitingBrochure`, `priority`) on an approved item does **not** revert it — those are routing/display metadata, not the reviewed substance an approval represents.

This is the concrete mechanism behind "an approved item is a promise that a human reviewed exactly this text" — that promise is voided automatically the instant the text changes, with no way to bypass it from the API surface.

## 5. Approved-content-only is enforced at the read boundary, not just the UI

The runtime-facing read path (`ListWaitingBrochureItemsUseCase` → `KnowledgeRepository.listApprovedForRuntime`) hardcodes `status: "approved"` directly in the Prisma `where` clause — it is not a parameter a caller can override, and there is no alternate code path from `KnowledgeToolController` to the repository that skips this filter. A `draft` or `disabled` item is **structurally unreachable** from voice-orchestrator's brochure fetch, regardless of any application-layer bug elsewhere — verified directly by reading `infrastructure/prisma-knowledge.repository.ts`'s `listApprovedForRuntime` method, not merely asserted.

The equivalent AI-knowledge read path (also filtered to `approved`, `aiKnowledge: true`) exists at the repository/port level (`listApprovedForRuntime` accepts an `aiKnowledge` filter option identical in shape to the `waitingBrochure` one) but **no controller route or use case currently exposes it** — this phase built the waiting-brochure runtime read path because it directly closes docs/36's documented gap, but did not build an equivalent "AI conversation context" retrieval endpoint, since no part of the conversation/prompt-assembly pipeline was asked to consume tenant knowledge in this phase. This is a real, honest scope boundary: the data model and repository support it; the runtime doesn't consume it yet.

## 6. Audit trail

Every mutation (`update`, `approve`, `disable`) writes one `AuditLog` row via a new shared `apps/core-api/src/shared/audit/` port + Prisma repository — the **first** writer to the pre-existing `AuditLog` model, which was schema-only and completely unused before this phase (confirmed by audit: exactly one prior reference anywhere in `core-api`, a comment noting it as the intended mechanism, never wired to any actual write). Each entry carries `actorId`, `actorType: "user"`, `action` (`"knowledge.updated"` / `"knowledge.approved"` / `"knowledge.disabled"`), `resourceType: "knowledge_item"`, `resourceId`, and `before`/`after` snapshots of the full row. `AuditLog` remains append-only at the database level (`REVOKE UPDATE, DELETE ... FROM app_runtime`, unchanged from its original RLS migration) — nothing added in this phase touches that guarantee.

## 7. Routes

| Method  | Path                                               | Auth                       | Purpose                                                                                                                                                                                                                                                                |
| ------- | -------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`   | `/dashboard/knowledge?businessId=`                 | JWT, owner/admin           | Paginated, filterable list (`status`, `category`, `aiKnowledge`, `waitingBrochure`)                                                                                                                                                                                    |
| `GET`   | `/dashboard/knowledge/:id`                         | JWT, owner/admin           | Single item                                                                                                                                                                                                                                                            |
| `POST`  | `/dashboard/knowledge`                             | JWT, owner/admin           | Create — always starts in `draft`, regardless of any status field a caller attempts to send (the DTO has no status field at all; the use case's command type has none either; the repository's `create` method hardcodes it — three independent layers, not one check) |
| `PATCH` | `/dashboard/knowledge/:id`                         | JWT, owner/admin           | Edit — triggers the auto-revert in §4 when applicable                                                                                                                                                                                                                  |
| `POST`  | `/dashboard/knowledge/:id/approve`                 | JWT, owner/admin           | `draft → approved` only                                                                                                                                                                                                                                                |
| `POST`  | `/dashboard/knowledge/:id/disable`                 | JWT, owner/admin           | `draft` or `approved` → `disabled`                                                                                                                                                                                                                                     |
| `GET`   | `/internal/knowledge/:businessId/waiting-brochure` | API-key, unrestricted role | Approved + `waitingBrochure`-flagged items, priority-ordered, `{id, text}[]` — voice-orchestrator's actual consumption point                                                                                                                                           |

`KnowledgeController` is `@Roles("owner", "admin")`-gated — approving content that will be spoken to real callers is a meaningful safety action, kept to the same role tier as emergency-rule and usage configuration, not opened to `dispatcher`/`viewer`.

## 8. How this reaches a real caller (the full path, end to end)

```
Tenant admin creates/edits knowledge item (draft)
        ↓
Tenant admin approves it (draft → approved)
        ↓
GET /internal/knowledge/:businessId/waiting-brochure
  (voice-orchestrator's HttpCapacityConfigProvider, called on every call start)
        ↓
selectBrochureSegment(config.brochure, waitedMs)   [docs/36, unchanged by this phase]
  — pure function, rotates through only what was returned above, wraps rather
    than repeats, returns null if the brochure is disabled or empty
        ↓
429 response's waitingExperience.brochureSegment
  (only when a caller genuinely could not be admitted — never during normal
   in-progress turns, per docs/36 §7's filler-phrase distinction, unchanged)
```

Nothing in this chain can surface a `draft` or `disabled` item — enforced at the Prisma query (§5), not merely by application-layer discipline that a future change could accidentally weaken.

## 9. Tenant isolation

Every use case takes `tenantId` from the authenticated principal (`AuthPrincipal`, JWT claims for the dashboard routes, the API key's own tenant binding for the internal route) — never from a client-controllable field. Every repository method is `db`-parameterized and runs inside `TenantContextService.run(tenantId, ...)`, so Postgres RLS (`tenant_id = current_setting('app.tenant_id', true)::uuid`, the identical policy shape every other tenant-scoped table in this schema uses) is the real enforcement boundary, not an application-layer filter that could be bypassed by a bug in one query.

## 10. Tests

Full coverage across every use case: creation always starts draft (3 independent enforcement points, §7), the auto-revert safety property (content-changed vs. content-resubmitted-unchanged vs. non-content-field-only edits), every valid/invalid lifecycle transition (`knowledge-lifecycle.spec.ts`), audit log entries written with correct actor/action/resource on update/approve/disable, and fake-repository-enforced tenant isolation (the fakes used in these specs genuinely filter by `tenantId`, not accept it as a no-op parameter, so a cross-tenant-leak test is meaningful rather than trivially passing).

## 11. What was deliberately not built in this phase

- A CRUD/versioning UI (docs/37 §11 — no frontend exists in this repo).
- An AI-knowledge retrieval endpoint consumed by the conversation/prompt pipeline (§5 — the data model and repository support it, nothing currently reads it for that purpose).
- Document/PDF ingestion — explicitly out of scope per the original request; the `content` field is free text only, entered directly, not extracted from an uploaded file.
- Any mechanism preventing a tenant from entering false claims (fake awards, invented pricing, etc.) — this system enforces _approved-content-only_, not _factually-true-content-only_. Truthfulness of what a tenant approves remains the tenant's own responsibility, exactly as it would for any other business's marketing copy; this was never something software could verify.
