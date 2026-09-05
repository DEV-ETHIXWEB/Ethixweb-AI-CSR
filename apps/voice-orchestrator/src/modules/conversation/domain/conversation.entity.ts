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
   * The caller's phone number as reported by the telephony provider,
   * captured once at call start (StartConversationUseCase) — required on
   * `StartConversationCommand` itself, but optional here (not set on
   * conversations created before this field existed) so a missing value
   * reads as "no ANI available" rather than crashing old data. Exists so
   * `runTurn`'s `searchCustomer` backstop (see `hasCalledSearchCustomer`)
   * has a phone number to search with without depending on the model
   * having echoed it into a message first.
   */
  callerAni?: string;
  /**
   * True once `searchCustomer` has executed at least one time this
   * conversation (real model call or the deterministic backstop — see
   * `hasCalledSearchCustomer`'s own comment). Found live: a real ~7-minute
   * phone call with a valid caller ANI present the entire time NEVER once
   * called `searchCustomer`, despite the tool's own description calling it
   * "First tool called on every inbound call" and the platform prompt
   * instructing the same — the exact same LLM-sampling-variance gap
   * `emergencyEverChecked`'s backstop already closed for escalateEmergency,
   * just never extended to this tool. Mirrors `emergencyEverChecked`'s own
   * compaction-survival rationale.
   */
  searchCustomerEverChecked?: boolean;
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
   * The exact caller transcript that most recently triggered an
   * escalateEmergency check (real or backstop) — set alongside
   * `emergencyEverChecked`. Found live: a caller turn whose transcript
   * "looks emergency-adjacent" (see `looksEmergencyAdjacent` in
   * handle-turn.use-case.ts) is deliberately allowed to re-trigger the
   * backstop even after `emergencyEverChecked` is already true — an
   * unrelated turn-1 check must not permanently suppress a genuinely
   * new emergency described 20 minutes later. But `runTurn`'s tool loop
   * runs `command.transcript` (the SAME caller turn) through several
   * completion iterations, and that same transcript would otherwise
   * re-match `looksEmergencyAdjacent` on every one of them — this field
   * is what tells a LATER iteration of the SAME turn "already checked
   * this exact one," so only a genuinely different, later caller turn
   * can trigger a second check.
   */
  lastEmergencyCheckedTranscript?: string;
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
