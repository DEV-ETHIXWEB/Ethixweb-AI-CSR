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

  private constructor(conversation: Conversation) {
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
  }

  static fromDomain(conversation: Conversation): ConversationResponseDto {
    return new ConversationResponseDto(conversation);
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

  constructor(result: {
    conversationId: string;
    responseText: string;
    toolCallsExecuted: string[];
    interrupted: boolean;
    state: ConversationState;
  }) {
    this.conversationId = result.conversationId;
    this.responseText = result.responseText;
    this.toolCallsExecuted = result.toolCallsExecuted;
    this.interrupted = result.interrupted;
    this.state = result.state;
  }
}
