import { ConflictDomainError } from "../../../shared/domain/domain-error";
import type { CallStatus } from "./call.entity";

/**
 * The call status state machine — deliberately minimal, matching this
 * module's own narrow scope (see call.entity.ts's own comment): a call is
 * `in_progress` from creation, then terminates into exactly one of
 * `completed` (a normal end-conversation signal) or `abandoned` (the
 * runtime disconnected/never produced a lead, docs/13's own item 2 "status
 * transitions"). Same discipline as lead-lifecycle.ts/tenant-lifecycle.ts:
 * an explicit, tested transition function, not scattered assignments.
 */
const ALLOWED_TRANSITIONS: Record<CallStatus, readonly CallStatus[]> = {
  in_progress: ["completed", "abandoned"],
  completed: [],
  abandoned: [],
};

export class IllegalCallStatusTransitionError extends ConflictDomainError {
  constructor(
    public readonly from: CallStatus,
    public readonly to: CallStatus,
  ) {
    super(`Illegal call status transition: "${from}" -> "${to}"`);
    this.name = "IllegalCallStatusTransitionError";
  }
}

/** Same-status "transitions" are an idempotent no-op — same convention as the lead/tenant lifecycles: a Voice Runtime retry of an end-call signal must not error. */
export function assertValidCallStatusTransition(from: CallStatus, to: CallStatus): void {
  if (from === to) {
    return;
  }
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new IllegalCallStatusTransitionError(from, to);
  }
}

export function isTerminalCallStatus(status: CallStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}
