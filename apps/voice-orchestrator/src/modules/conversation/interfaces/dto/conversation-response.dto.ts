import { ApiProperty } from "@nestjs/swagger";
import type { Conversation, TranscriptTurn } from "../../domain/conversation.entity";
import type { ConversationState } from "../../domain/conversation-state";

/** Deliberately omits `systemPrompt` and `messages` — the assembled prompt is proprietary platform IP and the raw message list contains full PII; neither belongs on an API response. Prompt Protection, per this phase's own security requirement. */
export class ConversationResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() tenantId: string;
  @ApiProperty() businessId: string;
  @ApiProperty() callId: string;
  @ApiProperty() state: ConversationState;
  @ApiProperty() llmModel: string;
  @ApiProperty({ nullable: true }) leadId: string | null;
  @ApiProperty() turnCount: number;
  @ApiProperty() startedAt: string;
  @ApiProperty({ nullable: true }) endedAt: string | null;
  @ApiProperty({ nullable: true }) endReason: string | null;
  @ApiProperty({
    required: false,
    description:
      "Present only on the response from POST /conversations (start) — the AI's opening line, generated once at call start, which the Voice Runtime must speak before it ever opens the mic for real. Docs/28 §J previously had no greeting step at all, so this field didn't exist on ANY response: every call connected and then both sides waited in silence for the other to speak first. Absent (not null/empty) on get/interrupt/end, which have no greeting to report.",
  })
  greeting?: string;

  private constructor(conversation: Conversation, greeting?: string) {
    this.id = conversation.id;
    this.tenantId = conversation.tenantId;
    this.businessId = conversation.businessId;
    this.callId = conversation.callId;
    this.state = conversation.state;
    this.llmModel = conversation.llmModel;
    this.leadId = conversation.leadId;
    this.turnCount = conversation.transcript.length;
    this.startedAt = conversation.startedAt;
    this.endedAt = conversation.endedAt;
    this.endReason = conversation.endReason;
    if (greeting !== undefined) {
      this.greeting = greeting;
    }
  }

  static fromDomain(conversation: Conversation, greeting?: string): ConversationResponseDto {
    return new ConversationResponseDto(conversation, greeting);
  }
}

export class TranscriptTurnResponseDto {
  @ApiProperty() turnIndex: number;
  @ApiProperty() speaker: "caller" | "agent";
  @ApiProperty() text: string;
  @ApiProperty({ nullable: true }) confidence: number | null;
  @ApiProperty() offsetMs: number;
  @ApiProperty() at: string;

  private constructor(turn: TranscriptTurn) {
    this.turnIndex = turn.turnIndex;
    this.speaker = turn.speaker;
    this.text = turn.text;
    this.confidence = turn.confidence;
    this.offsetMs = turn.offsetMs;
    this.at = turn.at;
  }

  static fromDomain(turn: TranscriptTurn): TranscriptTurnResponseDto {
    return new TranscriptTurnResponseDto(turn);
  }
}

export class TurnResultResponseDto {
  @ApiProperty() conversationId: string;
  @ApiProperty({ description: "What the Voice Runtime should synthesize and speak." })
  responseText: string;
  @ApiProperty({ type: [String] }) toolCallsExecuted: string[];
  @ApiProperty() interrupted: boolean;
  @ApiProperty() state: ConversationState;
  @ApiProperty({
    required: false,
    description:
      'Present iff escalateEmergency succeeded this turn (docs/28 §M). action === "forward_call" is the runtime\'s signal to execute the actual SIP/PSTN transfer — this service never places or transfers calls itself.',
  })
  escalation?: { severity: string; action: string; transferDestination: string | null };

  constructor(result: {
    conversationId: string;
    responseText: string;
    toolCallsExecuted: string[];
    interrupted: boolean;
    state: ConversationState;
    escalation?: { severity: string; action: string; transferDestination: string | null };
  }) {
    this.conversationId = result.conversationId;
    this.responseText = result.responseText;
    this.toolCallsExecuted = result.toolCallsExecuted;
    this.interrupted = result.interrupted;
    this.state = result.state;
    if (result.escalation) {
      this.escalation = result.escalation;
    }
  }
}
