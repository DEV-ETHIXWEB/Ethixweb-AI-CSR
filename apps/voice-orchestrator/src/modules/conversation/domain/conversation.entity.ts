import type { AiMessage } from "../../ai-provider/domain/ai-provider.port";
import type { ConversationState } from "./conversation-state";

export interface TranscriptTurn {
  turnIndex: number;
  speaker: "caller" | "agent";
  text: string;
  /** STT confidence, per docs/03 §5 ("STT confidence score is available to the LLM as part of the transcript metadata"). Null for agent turns. */
  confidence: number | null;
  offsetMs: number;
  at: string;
}

export interface Conversation {
  id: string;
  tenantId: string;
  businessId: string;
  /** The Voice Runtime's call identifier — becomes `leads.call_id` when createLead fires. */
  callId: string;
  state: ConversationState;
  /** Assembled once at call start (docs/03 §1) — not re-derived per turn, so prompt caching stays effective (docs/02 §3). */
  systemPrompt: string;
  llmModel: string;
  /** Full message history handed to the AI provider, including tool calls/results. */
  messages: AiMessage[];
  transcript: TranscriptTurn[];
  /** Set once createLead succeeds — makes `updateLead`'s "same call only" rule checkable and prevents a second lead per call. */
  leadId: string | null;
  /** Set at admission time (StartConversationUseCase) when the capacity gate reserved a slot for this call — released exactly once, best-effort, in EndConversationUseCase. Null only for conversations created before this field existed (defensive, not expected in normal operation — see EndConversationUseCase's own release guard). */
  capacityReservationId: string | null;
  startedAt: string;
  endedAt: string | null;
  endReason: string | null;
  /**
   * True once `escalateEmergency` has executed at least one time this
   * conversation (real model call or the deterministic backstop — see
   * `hasCalledEscalateEmergency`'s own comment, both count identically).
   * Found live: `compressMessages` (context-window.ts) replaces old
   * `messages` entries with a plain-text summary once a long call passes
   * the compaction threshold, which silently drops the `toolCalls` array
   * that a message-history-only check relied on — the backstop then
   * re-fired a SECOND time on turn 18 of a real ~10-minute call, costing
   * an extra full LLM round-trip on that turn for no reason. This field
   * is the durable signal that survives compaction; optional (not set on
   * conversations created before this field existed) so `undefined`
   * correctly reads as "not yet checked," same as `false`.
   */
  emergencyEverChecked?: boolean;
  /**
   * Optimistic-concurrency counter, starting at 1 on `create()` — the ONLY
   * field a use case never sets by hand; it travels unmodified from
   * whatever `findById`/`findByCallId` returned through to `save()`, which
   * uses it as the compare-and-swap check (RedisConversationRepository's
   * own comment). Necessary because two concurrent operations on the same
   * conversation is a real, previously-shipped-broken scenario (a live
   * turn's slow tool call racing an incoming end-of-call signal) — Redis
   * has no equivalent of Postgres's own transaction isolation to lean on
   * instead, and a blind last-write-wins `SET` silently loses whichever
   * side wrote first.
   */
  version: number;
}
