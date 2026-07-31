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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from "@nestjs/swagger";
import { CurrentPrincipal } from "../../../shared/auth/current-principal.decorator";
import { Roles } from "../../../shared/auth/roles.decorator";
import type { AuthPrincipal } from "../../../shared/auth/request-principal";
import { ClaimLeadUseCase } from "../application/claim-lead.use-case";
import { GetLeadUseCase } from "../application/get-lead.use-case";
import { ListLeadsUseCase } from "../application/list-leads.use-case";
import { TransitionLeadStatusUseCase } from "../application/transition-lead-status.use-case";
import { ClaimLeadDto } from "./dto/claim-lead.dto";
import { ClaimLeadResultResponseDto } from "./dto/lead-claim-response.dto";
import { LeadResponseDto } from "./dto/lead-response.dto";
import { ListLeadsQueryDto } from "./dto/list-leads-query.dto";
import { PaginatedLeadsResponseDto } from "./dto/paginated-leads-response.dto";
import { TransitionLeadStatusDto } from "./dto/transition-lead-status.dto";

/**
 * The dispatcher-facing lead inbox (docs/13-implementation-backlog.md
 * `leads` module §6) — list/filter, view, claim, and drive the status
 * state machine. Deliberately does NOT expose create/update: per
 * docs/04-ai-tool-architecture.md §3.3/§3.4, `createLead`/`updateLead` are
 * tools invoked by the AI tool broker mid-call (always holding a `call_id`
 * for a Call row that only the future Voice AI/telephony module creates),
 * not actions a human takes through a REST client. CreateLeadUseCase and
 * UpdateLeadUseCase are exported from LeadsModule as an application-layer
 * port for that future module to call directly — the same
 * cross-module-port pattern already established for
 * CustomerLookupPort/CrmLeadSyncPort, not a gap in this controller.
 */
@ApiBearerAuth("bearer")
@ApiSecurity("api-key")
@ApiTags("leads")
@Roles("owner", "admin", "dispatcher")
@Controller("leads")
export class LeadsController {
  constructor(
    private readonly listLeadsUseCase: ListLeadsUseCase,
    private readonly getLeadUseCase: GetLeadUseCase,
    private readonly claimLeadUseCase: ClaimLeadUseCase,
    private readonly transitionLeadStatusUseCase: TransitionLeadStatusUseCase,
  ) {}

  @Get()
  @ApiQuery({ name: "businessId", required: true })
  @ApiOperation({
    summary: "Dispatcher-facing lead inbox — paginated, filterable by status/priority/date",
  })
  @ApiResponse({ status: 200, description: "A page of leads", type: PaginatedLeadsResponseDto })
  @ApiResponse({ status: 403, description: "Caller's role is not one of owner/admin/dispatcher" })
  async list(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query() query: ListLeadsQueryDto,
  ): Promise<PaginatedLeadsResponseDto> {
    const result = await this.listLeadsUseCase.execute({
      tenantId: principal.tenantId,
      businessId: query.businessId,
      page: query.page,
      pageSize: query.pageSize,
      status: query.status,
      priority: query.priority,
      createdAfter: query.createdAfter ? new Date(query.createdAfter) : undefined,
      createdBefore: query.createdBefore ? new Date(query.createdBefore) : undefined,
    });
    return PaginatedLeadsResponseDto.fromDomain(result);
  }

  @Get(":id")
  @ApiOperation({ summary: "Fetch one of the caller's own tenant's leads by id" })
  @ApiResponse({ status: 200, description: "The lead", type: LeadResponseDto })
  @ApiResponse({ status: 403, description: "Caller's role is not one of owner/admin/dispatcher" })
  @ApiResponse({ status: 404, description: "No such lead for the caller's tenant" })
  async findOne(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<LeadResponseDto> {
    const lead = await this.getLeadUseCase.execute(principal.tenantId, id);
    return LeadResponseDto.fromDomain(lead);
  }

  @Post(":id/claim")
  @ApiOperation({
    summary: "A dispatcher takes ownership of a lead — exclusive, first claim wins (docs/13 §6)",
  })
  @ApiResponse({ status: 201, description: "Claimed", type: ClaimLeadResultResponseDto })
  @ApiResponse({ status: 403, description: "Caller's role is not one of owner/admin/dispatcher" })
  @ApiResponse({ status: 404, description: "No such lead for the caller's tenant" })
  @ApiResponse({ status: 409, description: "Lead already claimed, or not in a claimable status" })
  async claim(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ClaimLeadDto,
  ): Promise<ClaimLeadResultResponseDto> {
    // RolesGuard already guarantees principal.authType === "jwt" here — an
    // API-key principal never has a role, so it can never satisfy
    // @Roles(), the same reasoning AuthController.registerTeammate's own
    // comment documents for this exact cast.
    const jwtPrincipal = principal as Extract<AuthPrincipal, { authType: "jwt" }>;
    const result = await this.claimLeadUseCase.execute({
      tenantId: jwtPrincipal.tenantId,
      leadId: id,
      claimedByUserId: jwtPrincipal.userId,
      claimMethod: dto.claimMethod,
    });
    return ClaimLeadResultResponseDto.fromDomain(result);
  }

  @Post(":id/transition")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Drive the lead status state machine (e.g. mark expired/duplicate/abandoned) — docs/13 §4",
  })
  @ApiResponse({ status: 200, description: "Transitioned", type: LeadResponseDto })
  @ApiResponse({ status: 403, description: "Caller's role is not one of owner/admin/dispatcher" })
  @ApiResponse({ status: 404, description: "No such lead for the caller's tenant" })
  @ApiResponse({ status: 409, description: "Illegal transition from the lead's current status" })
  async transition(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: TransitionLeadStatusDto,
  ): Promise<LeadResponseDto> {
    const lead = await this.transitionLeadStatusUseCase.execute(
      principal.tenantId,
      id,
      dto.toStatus,
    );
    return LeadResponseDto.fromDomain(lead);
  }
}
