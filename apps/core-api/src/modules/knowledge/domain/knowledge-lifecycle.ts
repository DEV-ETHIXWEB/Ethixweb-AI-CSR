import { InvalidKnowledgeLifecycleTransitionError } from "./errors";
import type { KnowledgeItemStatus } from "./knowledge-item.entity";

/**
 * The knowledge item status state machine. Deliberately does NOT mirror
 * calls/domain/call-lifecycle.ts's "same-status is an idempotent no-op"
 * shortcut: approving an already-approved item, or disabling an
 * already-disabled item, must THROW here (spec requirement — "approving
 * from approved/disabled throws", "disabling an already-disabled item
 * throws"), not silently succeed. So every same-state pair (draft->draft,
 * approved->approved, disabled->disabled) is simply absent from the table
 * below and therefore already invalid under the plain lookup — no special
 * case needed.
 *
 * draft -> approved: valid (ApproveKnowledgeItemUseCase only).
 * draft -> disabled: valid (DisableKnowledgeItemUseCase).
 * approved -> disabled: valid (DisableKnowledgeItemUseCase).
 * disabled -> draft: valid in the table, though no use case in this build
 *   exercises it directly — intentionally left open for a future "re-open a
 *   disabled item back to draft for editing" flow, rather than narrowed to
 *   only the transitions currently wired to a use case.
 * approved -> draft: INVALID, and deliberately so. UpdateKnowledgeItemUseCase
 *   already has its own narrow, content-change-triggered auto-revert
 *   (approved + content edited -> draft) that bypasses this table entirely
 *   (it's a machine-triggered side effect of a legitimate content edit, not
 *   a status transition request). Allowing approved -> draft as a general
 *   transition here would let a caller silently move an approved item back
 *   to draft with NO content change at all, via direct status
 *   manipulation — an ambiguous, hard-to-audit action indistinguishable
 *   from the real auto-revert in the audit log. Forcing
 *   approved -> disabled -> draft as two explicit steps keeps every status
 *   change either machine-triggered-by-content-change or an explicit human
 *   action, never an ambiguous direct edit.
 */
const ALLOWED_TRANSITIONS: Record<KnowledgeItemStatus, readonly KnowledgeItemStatus[]> = {
  draft: ["approved", "disabled"],
  approved: ["disabled"],
  disabled: ["draft"],
};

export function assertValidKnowledgeStatusTransition(
  itemId: string,
  from: KnowledgeItemStatus,
  to: KnowledgeItemStatus,
): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new InvalidKnowledgeLifecycleTransitionError(itemId, from, to);
  }
}
