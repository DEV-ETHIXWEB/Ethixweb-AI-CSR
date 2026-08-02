import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiSecurity, ApiTags } from "@nestjs/swagger";
import { CurrentPrincipal } from "../../../shared/auth/current-principal.decorator";
import type { AuthPrincipal } from "../../../shared/auth/request-principal";
import { EndCallUseCase } from "../application/end-call.use-case";
import { GetCallUseCase } from "../application/get-call.use-case";
import { StartCallUseCase } from "../application/start-call.use-case";
import { CallResponseDto } from "./dto/call-response.dto";
import { EndCallDto } from "./dto/end-call.dto";
import { StartCallDto } from "./dto/start-call.dto";

/**
 * The production-blocker fix's HTTP surface — the tool broker/voice-runtime
 * execution surface for call lifecycle, identical pattern to
 * LeadsToolController/CustomersToolController (see either's own comment):
 * role-unrestricted, API-key-only, no `@Roles()`. Voice-orchestrator's
 * StartConversationUseCase calls `POST /internal/calls` BEFORE creating its
 * own (Redis-only) Conversation, so a real `Call` row always exists before
 * anything downstream (createLead) can reference that callId — this is
 * the fix that makes `Lead.callId`'s real database foreign key actually
 * satisfiable in production, not just in unit tests against fakes.
 */
@ApiBearerAuth("bearer")
@ApiSecurity("api-key")
@ApiTags("internal-tools")
@Controller("internal/calls")
export class CallsToolController {
  constructor(
    private readonly startCallUseCase: StartCallUseCase,
    private readonly endCallUseCase: EndCallUseCase,
    private readonly getCallUseCase: GetCallUseCase,
  ) {}

  @Post()
  @ApiOperation({
    summary:
      "docs/13 calls module item 2 — call started, tool-broker/runtime-facing, API-key auth only",
  })
  @ApiResponse({
    status: 201,
    description: "Call created (or the existing one, on a telephonyCallSid replay)",
    type: CallResponseDto,
  })
  async start(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() dto: StartCallDto,
  ): Promise<CallResponseDto> {
    const call = await this.startCallUseCase.execute({
      tenantId: principal.tenantId,
      businessId: dto.businessId,
      customerId: dto.customerId,
      direction: dto.direction,
      fromNumber: dto.fromNumber,
      toNumber: dto.toNumber,
      telephonyCallSid: dto.telephonyCallSid,
      startedAt: dto.startedAt,
    });
    return CallResponseDto.fromDomain(call);
  }

  @Post("by-telephony-sid/:telephonyCallSid/end")
  @ApiOperation({
    summary:
      "Call ended — idempotent, safe to call twice. Keyed on telephonyCallSid (the Voice Runtime's own call identifier), not core-api's internal Call.id, which the runtime never learns.",
  })
  @ApiResponse({ status: 200, description: "Call ended", type: CallResponseDto })
  @ApiResponse({ status: 404, description: "No such call for this tenant" })
  @ApiResponse({ status: 409, description: "Illegal status transition" })
  async end(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("telephonyCallSid") telephonyCallSid: string,
    @Body() dto: EndCallDto,
  ): Promise<CallResponseDto> {
    const call = await this.endCallUseCase.execute({
      tenantId: principal.tenantId,
      telephonyCallSid,
      status: dto.status,
      endReason: dto.endReason,
      endedAt: dto.endedAt,
    });
    return CallResponseDto.fromDomain(call);
  }

  @Get(":id")
  @ApiOperation({ summary: "Fetch a call's current status" })
  @ApiResponse({ status: 200, type: CallResponseDto })
  @ApiResponse({ status: 404, description: "No such call for this tenant" })
  async get(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<CallResponseDto> {
    const call = await this.getCallUseCase.execute(principal.tenantId, id);
    return CallResponseDto.fromDomain(call);
  }
}
