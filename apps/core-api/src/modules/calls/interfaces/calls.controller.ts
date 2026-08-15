import { Controller, Get, Param, ParseUUIDPipe, Query } from "@nestjs/common";
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
import { GetCallUseCase } from "../application/get-call.use-case";
import { ListCallsUseCase } from "../application/list-calls.use-case";
import { CallResponseDto } from "./dto/call-response.dto";
import { ListCallsQueryDto } from "./dto/list-calls-query.dto";
import { PaginatedCallsResponseDto } from "./dto/paginated-calls-response.dto";

/**
 * The dispatcher-facing call inbox — added for the dashboard's Live Calls
 * page (docs 27/28's dashboard module already composed ListCallsUseCase
 * internally for activeCallsCount/callsToday; this controller is the
 * first tenant-facing HTTP route for it). Mirrors LeadsController's exact
 * pattern (`@Roles("owner","admin","dispatcher")`, `@Query() dto` for
 * list, `principal.tenantId` never a client-supplied value).
 *
 * Deliberately does NOT expose start/end — those are voice-orchestrator's
 * own internal lifecycle actions (CallsToolController, `internal/calls`),
 * never something a dashboard user triggers directly.
 */
@ApiBearerAuth("bearer")
@ApiSecurity("api-key")
@ApiTags("calls")
@Roles("owner", "admin", "dispatcher")
@Controller("calls")
export class CallsController {
  constructor(
    private readonly listCallsUseCase: ListCallsUseCase,
    private readonly getCallUseCase: GetCallUseCase,
  ) {}

  @Get()
  @ApiQuery({ name: "businessId", required: true })
  @ApiOperation({
    summary: "Dispatcher-facing call inbox — paginated, filterable by status/date",
  })
  @ApiResponse({ status: 200, description: "A page of calls", type: PaginatedCallsResponseDto })
  @ApiResponse({ status: 403, description: "Caller's role is not one of owner/admin/dispatcher" })
  async list(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query() query: ListCallsQueryDto,
  ): Promise<PaginatedCallsResponseDto> {
    const result = await this.listCallsUseCase.execute({
      tenantId: principal.tenantId,
      businessId: query.businessId,
      page: query.page,
      pageSize: query.pageSize,
      status: query.status,
      createdAfter: query.createdAfter ? new Date(query.createdAfter) : undefined,
      createdBefore: query.createdBefore ? new Date(query.createdBefore) : undefined,
    });
    return PaginatedCallsResponseDto.fromDomain(result);
  }

  @Get(":id")
  @ApiOperation({ summary: "Fetch one of the caller's own tenant's calls by id" })
  @ApiResponse({ status: 200, description: "The call", type: CallResponseDto })
  @ApiResponse({ status: 403, description: "Caller's role is not one of owner/admin/dispatcher" })
  @ApiResponse({ status: 404, description: "No such call for the caller's tenant" })
  async findOne(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<CallResponseDto> {
    const call = await this.getCallUseCase.execute(principal.tenantId, id);
    return CallResponseDto.fromDomain(call);
  }
}
