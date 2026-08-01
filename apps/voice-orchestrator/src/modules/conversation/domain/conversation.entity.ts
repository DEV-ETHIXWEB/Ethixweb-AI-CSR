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
  startedAt: string;
  endedAt: string | null;
  endReason: string | null;
}
