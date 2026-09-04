import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { StructuredLogger } from "@ethixweb/shared-kernel";
import type { FastifyReply } from "fastify";
import { APP_LOGGER } from "../../../shared/observability/app-logger.module";
import { EndConversationUseCase } from "../application/end-conversation.use-case";
import { GetConversationByCallIdUseCase } from "../application/get-conversation-by-call-id.use-case";
import { GetConversationUseCase } from "../application/get-conversation.use-case";
import { HandleTurnUseCase } from "../application/handle-turn.use-case";
import { InterruptConversationUseCase } from "../application/interrupt-conversation.use-case";
import { StartConversationUseCase } from "../application/start-conversation.use-case";
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
    private readonly getConversationByCallId: GetConversationByCallIdUseCase,
    private readonly interruptConversation: InterruptConversationUseCase,
    @Inject(APP_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  @Post()
  @ApiOperation({
    summary:
      "Start a conversation for a connected call — assembles the layered system prompt (docs/03 §1)",
  })
  @ApiResponse({ status: 201, description: "Conversation started", type: ConversationResponseDto })
  @ApiResponse({ status: 409, description: "A conversation already exists for this callId" })
  async start(@Body() dto: StartConversationDto): Promise<ConversationResponseDto> {
    const { conversation, greeting } = await this.startConversation.execute({
      tenantId: dto.tenantId,
      businessId: dto.businessId,
      callId: dto.callId,
      callerAni: dto.callerAni,
      toNumber: dto.toNumber,
      timezone: dto.timezone,
      isEmergencyPriority: dto.isEmergencyPriority,
    });
    return ConversationResponseDto.fromDomain(conversation, greeting);
  }

  /**
   * Streamed as newline-delimited JSON (docs/28 §C.3), NOT a single JSON
   * response — the voice-conversation-latency optimization's headline
   * fix, built on real measurement: a real call's first LLM completion
   * produced real acknowledgment text alongside its tool calls, and that
   * text sat unused for the full duration of the tool round-trip and a
   * second completion (over a second of dead air) purely because the
   * OLD contract only ever returned text once the entire turn — every
   * completion, every tool call — had finished. Each `{"type":"chunk"}`
   * line is exactly one LLM iteration's new text (see
   * HandleTurnUseCase's own `onChunk` comment), so a caller can start
   * speaking the model's opening acknowledgment while a tool call is
   * still resolving in the background, the same pause a human takes
   * before continuing a sentence.
   *
   * `admitTurn()` runs FIRST and is allowed to throw normally (404/409,
   * unchanged from before this existed) — critically, BEFORE this
   * writes any response headers. HTTP cannot change a status code once
   * headers are sent, so the 404/409 error paths have to fully resolve
   * strictly before any streaming commitment; only a successful
   * admission ever reaches the `writeHead(200, ...)` line below. A
   * genuine failure AFTER that point (the AI provider erroring mid-turn)
   * can no longer become a different HTTP status — it becomes a
   * `{"type":"error"}` line instead, `retryable: true` matching exactly
   * what an uncaught error here would have produced as a 500 before
   * (docs/28 §G: 5xx is always retryable), so Voice Runtime's existing
   * retry-with-the-same-idempotencyKey logic needs no new case, only a
   * new place to read the same signal from.
   */
  @Post(":id/turns")
  @ApiOperation({
    summary:
      "Submit one finalized caller utterance; streams the LLM/tool loop's text as newline-delimited JSON (docs/28 §C.3) as it becomes available, ending with one 'done' line carrying the same shape as the old single-response contract",
  })
  @ApiResponse({
    status: 200,
    description:
      "application/x-ndjson: zero or more {type:'chunk', text} lines, then exactly one {type:'done', ...TurnResultResponseDto} or {type:'error', message, retryable} line",
  })
  @ApiResponse({ status: 404, description: "No such conversation for this tenant" })
  @ApiResponse({
    status: 409,
    description:
      "Conversation has already ended, or an identical turn (same idempotencyKey) is already in flight",
  })
  async turn(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: HandleTurnDto,
    @Res({ passthrough: false }) reply: FastifyReply,
  ): Promise<void> {
    const command = {
      tenantId: dto.tenantId,
      conversationId: id,
      idempotencyKey: dto.idempotencyKey,
      transcript: dto.transcript,
      sttConfidence: dto.sttConfidence,
      offsetMs: dto.offsetMs,
      allowedTools: dto.allowedTools,
    };

    // Pre-flight checks — throws normally here, no response committed
    // yet, exactly the same 404/409 behavior as before streaming existed.
    const admission = await this.handleTurn.admitTurn(command);

    // `Connection: close` — found live, not hypothetical: a real call's
    // 6th turn completed successfully here (this method ran to
    // completion, "turn processing completed" logged, reply.raw.end()
    // called) but the Voice Runtime client sat waiting on it for over
    // 30 seconds with total silence to the caller before a LATER,
    // unrelated turn's response finally arrived — turns before and
    // after it, on the same call, completed normally. That shape (works
    // repeatedly, then silently doesn't, no error either side) is the
    // signature of a reused keep-alive connection getting into a bad
    // state rather than anything wrong with any single request/response
    // — every earlier attempt at hardening the CLIENT's stream-reading
    // loop (see HttpOrchestratorClient's own comment) still left this
    // possible, because the client can only behave correctly with
    // whatever bytes the connection actually delivers to it. Forcing a
    // fresh connection per turn removes the keep-alive reuse path
    // entirely — the one variable neither side could fully control —
    // at the cost of one extra TCP handshake per turn, a real but small
    // price for a P0 that otherwise makes the caller hear total
    // silence with no bound short of a 20s client-side timeout.
    reply.raw.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      Connection: "close",
    });
    // Diagnostic visibility for the exact failure class above — a
    // write/close problem on this raw response previously had NO
    // signal anywhere in these logs; the turn just silently never
    // finished from the client's perspective. `error` fires on a
    // genuine socket-level failure; `close` fires whenever the
    // underlying connection ends, logged only when it happens BEFORE
    // this handler's own `reply.raw.end()` call below (`finished`
    // check) — a normal, expected close after we're done is not
    // worth logging on every turn.
    // `.once`, not `.on` — each fires at most once per request either
    // way, and this handler runs once per turn for the life of the
    // process; `.on` would leak a listener onto the underlying socket
    // for every single turn ever handled (caught by a real
    // MaxListenersExceededWarning while adding this very diagnostic —
    // see this file's own test suite run).
    reply.raw.once("error", (error: Error) => {
      this.logger.warn("turn response socket errored", {
        conversationId: id,
        reason: error.message,
      });
    });
    reply.raw.once("close", () => {
      if (!reply.raw.writableEnded) {
        this.logger.warn("turn response connection closed before the response finished", {
          conversationId: id,
        });
      }
    });
    const writeLine = (event: Record<string, unknown>): void => {
      const flushed = reply.raw.write(`${JSON.stringify(event)}\n`);
      if (!flushed) {
        this.logger.warn("turn response write reported backpressure", {
          conversationId: id,
          eventType: event["type"],
        });
      }
    };

    try {
      const result =
        admission.kind === "cached"
          ? admission.result
          : await admission.run((text) => writeLine({ type: "chunk", text }));
      if (admission.kind === "cached" && result.responseText) {
        writeLine({ type: "chunk", text: result.responseText });
      }
      writeLine({ type: "done", ...new TurnResultResponseDto(result) });
    } catch (error) {
      writeLine({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
      });
    } finally {
      reply.raw.end();
    }
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
    //
    // InterruptConversationUseCase (not the generic
    // TransitionConversationStateUseCase) specifically because Voice
    // Runtime only ever calls this endpoint when TTS was actively playing
    // an already-fully-generated response — the FULL response was already
    // durably saved into conversation.messages before playback even
    // started, so without this, the model's own memory of "what I just
    // said" would be silently wrong on every barge-in that lands mid-
    // playback. See that use case's own comment for the full finding.
    const conversation = await this.interruptConversation.execute(dto.tenantId, id);
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

  @Get("by-call/:callId")
  @ApiQuery({ name: "tenantId", required: true })
  @ApiOperation({
    summary:
      "Look up a conversation by the Voice Runtime's own callId (docs/24 §5) — for a runtime process that restarted mid-call and lost the conversationId it cached from the original POST / response.",
  })
  @ApiResponse({ status: 200, description: "The conversation", type: ConversationResponseDto })
  @ApiResponse({ status: 404, description: "No conversation for this tenant/callId" })
  async findByCallId(
    @Param("callId", ParseUUIDPipe) callId: string,
    @Query("tenantId", ParseUUIDPipe) tenantId: string,
  ): Promise<ConversationResponseDto> {
    const conversation = await this.getConversationByCallId.execute(tenantId, callId);
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
