import { ConflictDomainError } from "../../../shared/domain/domain-error";

/**
 * docs/03-conversation-engine.md §2's state machine, transcribed exactly:
 * "the LLM reasons WITHIN a state, but state transitions are deterministic
 * code, not free-form model judgment, so the call can never get stuck in an
 * undefined state."
 */
export const CONVERSATION_STATES = [
  "greeting",
  "identifying",
  "qualifying",
  "emergency_check",
  "emergency_transfer",
  "confirming",
  "closing",
  "human_requested",
  "voicemail",
  "silence",
  "ended",
] as const;

export type ConversationState = (typeof CONVERSATION_STATES)[number];

/** Transcribed edge-for-edge from docs/03 §2's stateDiagram. `ended` is this graph's explicit terminal node for the diagram's `[*]` exit arrows. */
const ALLOWED_TRANSITIONS: Record<ConversationState, readonly ConversationState[]> = {
  greeting: ["identifying", "silence"],
  identifying: ["qualifying", "silence"],
  qualifying: ["emergency_check", "confirming", "human_requested", "voicemail", "silence"],
  emergency_check: ["emergency_transfer", "qualifying"],
  emergency_transfer: ["ended"],
  confirming: ["closing", "qualifying"],
  closing: ["ended"],
  human_requested: ["ended"],
  voicemail: ["ended"],
  silence: ["qualifying", "voicemail"],
  ended: [],
};

export class IllegalConversationTransitionError extends ConflictDomainError {
  constructor(
    public readonly from: ConversationState,
    public readonly to: ConversationState,
  ) {
    super(`Illegal conversation state transition: "${from}" -> "${to}"`);
    this.name = "IllegalConversationTransitionError";
  }
}

/** Same-state "transitions" are an idempotent no-op — same convention as the tenant and lead lifecycles in apps/core-api. */
export function assertValidConversationTransition(
  from: ConversationState,
  to: ConversationState,
): void {
  if (from === to) {
    return;
  }
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new IllegalConversationTransitionError(from, to);
  }
}

export function isTerminalState(state: ConversationState): boolean {
  return ALLOWED_TRANSITIONS[state].length === 0;
}
