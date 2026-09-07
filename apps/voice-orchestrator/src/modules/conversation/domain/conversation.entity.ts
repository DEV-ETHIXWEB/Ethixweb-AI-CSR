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
   * True once `createLead` has executed at least one time this
   * conversation (attempted, not necessarily succeeded — a genuine
   * failure gets a structured error back to the model, which is a
   * separate, already-handled path; this only targets "never even
   * attempted"). Found live on a real ~21-minute, 99-turn call, and
   * reproduced fresh in a 3-turn test right after fixing the prompt
   * alone (v19) proved insufficient on its own: the caller gave a name
   * and always had a real Caller ANI on file, declined to give an
   * address, and asked for a callback — a clear enough signal to
   * capture the lead with what's known — but createCustomer/createLead
   * were never called at all, in either the real call or the
   * reproduction. Prompt wording alone has a reliability ceiling (the
   * same lesson already applied to escalateEmergency/searchCustomer);
   * `runTurn` uses this flag to inject an explicit reminder into the
   * model's own context once a call has gone on long enough without a
   * lead — never to fabricate the tool call itself with guessed data,
   * only to make sure the model doesn't lose track of a pending action
   * it alone has the real customer data to complete.
   *
   * ONLY set by a `createLead` attempt — deliberately NOT by
   * `createCustomer` (see `customerCaptureAttempted` for that). These
   * are two different tools with two different preconditions
   * (`createLead` requires a `customer_id` a successful `createCustomer`
   * produced first), so conflating "have we tried to capture this
   * caller at all" into one flag is exactly the bug a real forensic call
   * transcript found: the "no customer/lead record has been created
   * yet" reminder (`annotateMissingLead`) kept firing on every single
   * turn for the rest of a real ~4m50s call, despite `createCustomer`
   * having already been attempted twice (rejected, then degraded — no
   * CRM configured), because nothing had ever touched THIS flag.
   */
  leadEverAttempted?: boolean;
  /**
   * Set once `createCustomer` succeeds this call — lets `runTurn` tell
   * the model to call `createLead` NEXT (using this id) instead of
   * re-injecting the "call createCustomer" reminder once a customer
   * record already exists, which would be actively wrong/confusing.
   * Distinct from `leadId` (set by `createLead`, the actual commit
   * action) — a call can have a `customerId` with no `leadId` for a
   * long stretch (customer captured, still qualifying) and that's a
   * normal, not a broken, state.
   */
  customerId?: string | null;
  /**
   * True once `createCustomer` has executed at least one time this
   * conversation, any outcome — the `createCustomer` counterpart to
   * `leadEverAttempted`. Exists so the reminder mechanism (and any
   * future logic) can distinguish "never even tried" from "tried and
   * something happened," independently of whether that something was a
   * success, a self-correctable validation rejection, or a permanent
   * infrastructure block (see `crmIntegrationUnavailable`).
   */
  customerCaptureAttempted?: boolean;
  /**
   * True once a `createCustomer` OR `createLead` attempt has failed for
   * a PERMANENT, infrastructure-level reason this call cannot talk its
   * way around — currently, specifically, core-api reporting
   * `NoCrmIntegrationConfiguredError` (no CRM integration configured for
   * this business at all). Deliberately NOT set for a validation
   * rejection (malformed arguments — e.g. the real call where the model
   * first passed `name` as a bare string instead of `{first, last}`):
   * that class of failure is often genuinely self-correctable on the
   * model's very next attempt, and DID self-correct in the real call
   * that surfaced this whole area, so suppressing the reminder for it
   * too would have cost the real, eventually-successful retry. Once
   * true: (1) the missing-lead reminder stops firing entirely — nagging
   * the model to retry an integration that structurally cannot succeed
   * this call wastes context/attention for zero possible benefit; (2)
   * `annotateMissingLead`'s own text (when it does still apply, before
   * this flag is set) never promises the caller a callback that nothing
   * downstream can actually deliver — see the platform prompt's own
   * handling of this exact signal.
   */
  crmIntegrationUnavailable?: boolean;
  /**
   * True once `getServiceAreas` has executed at least one time this
   * conversation (H2 — the same "durable flag survives compaction" shape
   * as `searchCustomerEverChecked`/`emergencyEverChecked`). `messages`
   * carries the raw tool call/result, but `compressMessages`
   * (context-window.ts) deliberately drops `role: "tool"` entries once a
   * long call passes the compaction threshold — this flag, and
   * `lastServiceAreaCheck` below, are what's left to answer "did we
   * already check this" once that's happened.
   */
  serviceAreaChecked?: boolean;
  /**
   * The actual outcome of the most recent `getServiceAreas` success this
   * call — the `getServiceAreas` counterpart to `customerId`/`leadId`
   * (a durable OUTCOME value, not just an attempt flag). Exists so a
   * caller's own zip/in-area result can't silently flip or get re-guessed
   * later in a long call purely because the original tool result aged out
   * of the compacted message history — telling a serviceable caller
   * they're out of area (or vice versa) after already having the right
   * answer is a real customer-facing harm, not just a wasted round-trip.
   * `zip` is read from the tool call's own arguments (the handler's output
   * doesn't echo it back).
   */
  lastServiceAreaCheck?: { zip: string; inServiceArea: boolean } | null;
  /**
   * True once `getBusinessHours` has executed at least one time this
   * conversation — the `getBusinessHours` counterpart to
   * `serviceAreaChecked`. Distinct from `RuntimeContext.businessHours`
   * (prompt/domain/runtime-context.ts), which is a "right now" snapshot
   * baked into `systemPrompt` once at call start and is therefore already
   * compaction-proof by construction (the system prompt is never
   * compacted) — this instead covers a LIVE, mid-call `getBusinessHours`
   * call the model makes for a different day/time than "now" (e.g. "are
   * you open next Monday"), which goes through the ordinary tool loop and
   * has no other durable record once its own message ages out of context.
   */
  businessHoursChecked?: boolean;
  /** The actual outcome of the most recent `getBusinessHours` success this call — see `lastServiceAreaCheck`'s own comment for why this is tracked as a durable value, not just an attempt flag. */
  lastBusinessHoursCheck?: { isOpen: boolean; opensAt?: string | null; isHoliday: boolean } | null;
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
