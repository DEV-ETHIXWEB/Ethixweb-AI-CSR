import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { EndConversationUseCase } from "../application/end-conversation.use-case";
import { GetConversationUseCase } from "../application/get-conversation.use-case";
import { HandleTurnUseCase } from "../application/handle-turn.use-case";
import { StartConversationUseCase } from "../application/start-conversation.use-case";
import { TransitionConversationStateUseCase } from "../application/transition-conversation-state.use-case";
import {
  ConversationResponseDto,
  TranscriptTurnResponseDto,
  TurnResultResponseDto,
} from "./dto/conversation-response.dto";
import { EndConversationDto } from "./dto/end-conversation.dto";
import { HandleTurnDto } from "./dto/handle-turn.dto";
import { InterruptConversationDto } from "./dto/interrupt-conversation.dto";
import { StartConversationDto } from "./dto/start-conversation.dto";

/**
 * The Voice Runtime's entire interface to this service. Text in, text out
 * — no audio, no STT/TTS, no telephony concepts anywhere in these
 * signatures, which is precisely what lets the runtime swap between
 * Twilio/LiveKit/Retell/Vapi/OpenAI Realtime without any business logic
 * changing.
 *
 * `tenantId` arrives in the request body rather than being derived from a
 * session (unlike every apps/core-api controller): the caller is a
 * service, not a tenant user — see shared/auth/service-principal.ts's own
 * comment. Every use-case below still re-validates the conversation
 * belongs to that tenantId before touching it, so a wrong/hostile tenantId
 * yields a 404, never another tenant's data.
 */
@ApiBearerAuth("service-token")
@ApiTags("conversations")
@Controller("conversations")
export class ConversationsController {
  constructor(
    private readonly startConversation: StartConversationUseCase,
    private readonly handleTurn: HandleTurnUseCase,
    private readonly endConversation: EndConversationUseCase,
    private readonly getConversation: GetConversationUseCase,
    private readonly transitionState: TransitionConversationStateUseCase,
  ) {}

  @Post()
  @ApiOperation({
    summary:
      "Start a conversation for a connected call — assembles the layered system prompt (docs/03 §1)",
  })
  @ApiResponse({ status: 201, description: "Conversation started", type: ConversationResponseDto })
  @ApiResponse({ status: 409, description: "A conversation already exists for this callId" })
  async start(@Body() dto: StartConversationDto): Promise<ConversationResponseDto> {
    const conversation = await this.startConversation.execute({
      tenantId: dto.tenantId,
      businessId: dto.businessId,
      callId: dto.callId,
      callerAni: dto.callerAni,
      toNumber: dto.toNumber,
      timezone: dto.timezone,
    });
    return ConversationResponseDto.fromDomain(conversation);
  }

  @Post(":id/turns")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Submit one finalized caller utterance; runs the LLM/tool loop and returns the text for the runtime to speak",
  })
  @ApiResponse({ status: 200, description: "The agent's response", type: TurnResultResponseDto })
  @ApiResponse({ status: 404, description: "No such conversation for this tenant" })
  @ApiResponse({
    status: 409,
    description:
      "Conversation has already ended, or an identical turn (same idempotencyKey) is already in flight",
  })
  async turn(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: HandleTurnDto,
  ): Promise<TurnResultResponseDto> {
    const result = await this.handleTurn.execute({
      tenantId: dto.tenantId,
      conversationId: id,
      idempotencyKey: dto.idempotencyKey,
      transcript: dto.transcript,
      sttConfidence: dto.sttConfidence,
      offsetMs: dto.offsetMs,
      allowedTools: dto.allowedTools,
    });
    return new TurnResultResponseDto(result);
  }

  @Post(":id/interrupt")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Barge-in: the caller started speaking while TTS was still playing",
  })
  @ApiResponse({
    status: 200,
    description: "Conversation transitioned",
    type: ConversationResponseDto,
  })
  @ApiResponse({ status: 404, description: "No such conversation for this tenant" })
  @ApiResponse({
    status: 409,
    description: "Illegal state transition, or conversation has already ended",
  })
  async interrupt(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: InterruptConversationDto,
  ): Promise<ConversationResponseDto> {
    // docs/03 §6 + 01 §3 model barge-in as TTS-cancel/LLM-continue with NO
    // state-machine transition (VAD -.-> LLM Gateway directly) — that's
    // handleTurn's abort `signal`, already implemented. `silence` is in
    // fact the OPPOSITE documented case (VAD timeout: caller says
    // nothing). No state is documented for "caller interrupted", so
    // targeting `silence` here is an INFERRED default, flagged per this
    // codebase's convention (see tool-catalog.ts's getServiceAreas
    // comment) — it's the only state shaped like an interrupted call
    // needs: reachable from greeting/identifying/qualifying, recovers back
    // to qualifying.
    const conversation = await this.transitionState.execute(dto.tenantId, id, "silence");
    return ConversationResponseDto.fromDomain(conversation);
  }

  @Post(":id/end")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "End a conversation — idempotent, safe to call twice" })
  @ApiResponse({ status: 200, description: "Conversation ended", type: ConversationResponseDto })
  @ApiResponse({ status: 404, description: "No such conversation for this tenant" })
  async end(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: EndConversationDto,
  ): Promise<ConversationResponseDto> {
    const conversation = await this.endConversation.execute({
      tenantId: dto.tenantId,
      conversationId: id,
      endReason: dto.endReason,
    });
    return ConversationResponseDto.fromDomain(conversation);
  }

  @Get(":id")
  @ApiQuery({ name: "tenantId", required: true })
  @ApiOperation({
    summary: "Fetch conversation session state (never the system prompt or raw messages)",
  })
  @ApiResponse({ status: 200, description: "The conversation", type: ConversationResponseDto })
  @ApiResponse({ status: 404, description: "No such conversation for this tenant" })
  async findOne(
    @Param("id", ParseUUIDPipe) id: string,
    @Query("tenantId", ParseUUIDPipe) tenantId: string,
  ): Promise<ConversationResponseDto> {
    const conversation = await this.getConversation.execute(tenantId, id);
    return ConversationResponseDto.fromDomain(conversation);
  }

  @Get(":id/transcript")
  @ApiQuery({ name: "tenantId", required: true })
  @ApiOperation({ summary: "Full turn-by-turn transcript for this conversation" })
  @ApiResponse({ status: 200, description: "The transcript", type: [TranscriptTurnResponseDto] })
  @ApiResponse({ status: 404, description: "No such conversation for this tenant" })
  async transcript(
    @Param("id", ParseUUIDPipe) id: string,
    @Query("tenantId", ParseUUIDPipe) tenantId: string,
  ): Promise<TranscriptTurnResponseDto[]> {
    const conversation = await this.getConversation.execute(tenantId, id);
    return conversation.transcript.map((turn) => TranscriptTurnResponseDto.fromDomain(turn));
  }
}
