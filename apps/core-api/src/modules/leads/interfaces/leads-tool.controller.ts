import { Body, Controller, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiSecurity, ApiTags } from "@nestjs/swagger";
import { CurrentPrincipal } from "../../../shared/auth/current-principal.decorator";
import type { AuthPrincipal } from "../../../shared/auth/request-principal";
import { CreateLeadUseCase } from "../application/create-lead.use-case";
import { UpdateLeadUseCase } from "../application/update-lead.use-case";
import { CreateLeadToolDto } from "./dto/create-lead-tool.dto";
import { LeadResponseDto } from "./dto/lead-response.dto";
import { UpdateLeadToolDto } from "./dto/update-lead-tool.dto";

/**
 * The tool broker's execution surface for docs/04-ai-tool-architecture.md
 * §3.3 (`createLead`) and §3.4 (`updateLead`) — separate from the
 * dispatcher-facing LeadsController for the identical reason
 * CustomersToolController is separate from CustomersController (see that
 * file's own comment): role-unrestricted, API-key-only, no `@Roles()`.
 * This is also literally the seam LeadsModule's own exports comment
 * anticipated ("CreateLeadUseCase/UpdateLeadUseCase are exported directly
 * ... for the future Voice AI module to inject") — now that the Voice AI
 * Orchestrator is a separate service/process rather than an in-process
 * consumer, "inject" becomes "call over HTTP," and this controller is
 * that HTTP surface.
 */
@ApiBearerAuth("bearer")
@ApiSecurity("api-key")
@ApiTags("internal-tools")
@Controller("internal/leads")
export class LeadsToolController {
  constructor(
    private readonly createLeadUseCase: CreateLeadUseCase,
    private readonly updateLeadUseCase: UpdateLeadUseCase,
  ) {}

  @Post()
  @ApiOperation({ summary: "docs/04 §3.3 createLead — tool-broker-facing, API-key auth only" })
  @ApiResponse({
    status: 201,
    description: "Lead created (or the existing one, on a call_id race)",
    type: LeadResponseDto,
  })
  async create(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() dto: CreateLeadToolDto,
  ): Promise<LeadResponseDto> {
    const lead = await this.createLeadUseCase.execute({
      tenantId: principal.tenantId,
      businessId: dto.businessId,
      customerId: dto.customerId,
      callId: dto.callId,
      problemSummary: dto.problemSummary,
      priority: dto.priority,
      leadType: dto.leadType,
      qualificationData: dto.qualificationData,
    });
    return LeadResponseDto.fromDomain(lead);
  }

  @Patch(":id")
  @ApiOperation({ summary: "docs/04 §3.4 updateLead — tool-broker-facing, API-key auth only" })
  @ApiResponse({ status: 200, description: "Updated", type: LeadResponseDto })
  @ApiResponse({ status: 403, description: "callId doesn't match the lead's creating call" })
  @ApiResponse({ status: 404, description: "No such lead for the caller's tenant" })
  async update(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateLeadToolDto,
  ): Promise<LeadResponseDto> {
    const lead = await this.updateLeadUseCase.execute({
      tenantId: principal.tenantId,
      leadId: id,
      callId: dto.callId,
      patch: {
        problemSummary: dto.problemSummary,
        priority: dto.priority,
        leadType: dto.leadType,
      },
    });
    return LeadResponseDto.fromDomain(lead);
  }
}
