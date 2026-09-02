/**
 * This service's ENTIRE surface with voice-orchestrator — docs/28 §A's six
 * endpoints, one method each. Every field name/shape below is copied
 * verbatim from docs/28 §B/§C, not re-derived — if this drifts from that
 * doc, the doc (or the live service) is the source of truth, not this file.
 */

export interface StartConversationRequest {
  tenantId: string;
  businessId: string;
  callId: string;
  callerAni: string;
  toNumber?: string | undefined;
  timezone?: string | undefined;
}

export type ConversationState =
  | "greeting"
  | "identifying"
  | "qualifying"
  | "emergency_check"
  | "emergency_transfer"
  | "confirming"
  | "closing"
  | "human_requested"
  | "voicemail"
  | "silence"
  | "ended";

export interface ConversationResponse {
  id: string;
  tenantId: string;
  businessId: string;
  callId: string;
  state: ConversationState;
  llmModel: string;
  leadId: string | null;
  turnCount: number;
  startedAt: string;
  endedAt: string | null;
  endReason: string | null;
  /**
   * Present only on the response from `startConversation` — the AI's
   * opening line, which this runtime MUST speak before it ever opens the
   * mic for real. Found live, not hypothetical: docs/28 §J previously had
   * no greeting step at all, so every real call connected successfully
   * and then both sides waited in silence for the other to speak first,
   * forever — no scripted scenario test caught it because every one of
   * them posted the caller's opening line as the conversation's first
   * turn, never exercising whether the AI spoke unprompted.
   */
  greeting?: string;
}

export interface HandleTurnRequest {
  tenantId: string;
  /** Unique per turn ATTEMPT — reused verbatim on retry of the same attempt (docs/28 §B.2, "the single most important integration detail"). */
  idempotencyKey: string;
  transcript: string;
  sttConfidence?: number | undefined;
  offsetMs?: number | undefined;
  allowedTools: readonly string[];
}

export interface TurnResult {
  conversationId: string;
  responseText: string;
  toolCallsExecuted: string[];
  interrupted: boolean;
  state: ConversationState;
  /** docs/28 §C.2 (added Phase 15B) — present iff escalateEmergency fired this turn. `action: "forward_call"` is this runtime's cue to execute the actual transfer. */
  escalation?:
    | {
        severity: string;
        action: string;
        /** The real, currently-on-call phone number to transfer to — resolved server-side (core-api's ResolveOnCallUseCase, docs/07 §5.3). `null` when action isn't forward_call or no on-call target could be resolved, in which case CallSessionOrchestrator falls back to its own static EMERGENCY_TRANSFER_NUMBER/HUMAN_FALLBACK_NUMBER chain. */
        transferDestination: string | null;
      }
    | undefined;
}

export interface InterruptRequest {
  tenantId: string;
}

export interface EndConversationRequest {
  tenantId: string;
  endReason: string;
}

/**
 * Thrown for the 429 capacity-exceeded response (docs/36, capacity-exceeded.filter.ts).
 * A distinct type from OrchestratorHttpError because the runtime's reaction
 * is fundamentally different: speak the brochure and retry, not fail the
 * call.
 */
export class OrchestratorCapacityExceededError extends Error {
  constructor(
    public readonly retryAfterSeconds: number,
    public readonly waitingExperience: {
      brochureSegment: { id: string; text: string } | null;
      overflowNumber: string | null;
    },
  ) {
    super("voice-orchestrator rejected call admission: capacity exceeded");
    this.name = "OrchestratorCapacityExceededError";
  }
}

/** A conversation already exists for this callId (docs/28 §B.1's 409) — the runtime's own retry-of-a-successful-start case, distinct from a genuine failure. */
export class OrchestratorConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrchestratorConflictError";
  }
}

/** Any other non-2xx response — 4xx (client bug, don't blindly retry) or 5xx (retry per docs/28 §G). `retryable` lets callers apply withRetry's isRetryable without re-deriving it from statusCode at every call site. */
export class OrchestratorHttpError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "OrchestratorHttpError";
  }
}

export interface OrchestratorClientPort {
  startConversation(req: StartConversationRequest): Promise<ConversationResponse>;
  /** `signal` aborts the in-flight HTTP call directly — docs/28 §B.3's mid-turn barge-in mechanism (mechanism 1 of 2). */
  handleTurn(
    conversationId: string,
    req: HandleTurnRequest,
    signal?: AbortSignal,
  ): Promise<TurnResult>;
  interrupt(conversationId: string, req: InterruptRequest): Promise<ConversationResponse>;
  endConversation(
    conversationId: string,
    req: EndConversationRequest,
  ): Promise<ConversationResponse>;
}

export const ORCHESTRATOR_CLIENT = Symbol("ORCHESTRATOR_CLIENT");
