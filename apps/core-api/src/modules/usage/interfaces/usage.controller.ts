import { Controller, Get, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiSecurity, ApiTags } from "@nestjs/swagger";
import { CurrentPrincipal } from "../../../shared/auth/current-principal.decorator";
import { Roles } from "../../../shared/auth/roles.decorator";
import type { AuthPrincipal } from "../../../shared/auth/request-principal";
import { GetCallUsageUseCase } from "../application/get-call-usage.use-case";
import { GetUsageSummaryUseCase } from "../application/get-usage-summary.use-case";
import { UsageRecordResponseDto } from "./dto/usage-record-response.dto";
import { UsageSummaryQueryDto } from "./dto/usage-summary-query.dto";
import { UsageSummaryResponseDto } from "./dto/usage-summary-response.dto";

/**
 * Dispatcher/owner-facing usage visibility — docs/26 §7: "why was this
 * tenant charged this amount" must be answerable from persisted system
 * data. `owner`/`admin`-only (not `dispatcher`/`viewer`): usage/cost data
 * is billing-adjacent, matching the same RBAC boundary
 * docs/08-security-observability-reliability.md §1.1 draws around billing
 * ("owner: billing, integration config, user management").
 */
@ApiBearerAuth("bearer")
@ApiSecurity("api-key")
@ApiTags("usage")
@Roles("owner", "admin")
@Controller("usage")
export class UsageController {
  constructor(
    private readonly getUsageSummaryUseCase: GetUsageSummaryUseCase,
    private readonly getCallUsageUseCase: GetCallUsageUseCase,
  ) {}

  @Get("summary")
  @ApiOperation({
    summary: "Deterministic usage totals by type, for a tenant/business over a period",
  })
  @ApiResponse({ status: 200, type: UsageSummaryResponseDto })
  @ApiResponse({ status: 422, description: "from must be strictly before to" })
  async summary(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query() query: UsageSummaryQueryDto,
  ): Promise<UsageSummaryResponseDto> {
    const summary = await this.getUsageSummaryUseCase.execute({
      tenantId: principal.tenantId,
      businessId: query.businessId,
      usageType: query.usageType,
      from: query.from,
      to: query.to,
    });
    return UsageSummaryResponseDto.fromDomain(summary);
  }

  @Get("calls/:callId")
  @ApiOperation({
    summary:
      "Every usage record correlated to one call, chronological — the raw evidence trail for a single call's usage",
  })
  @ApiResponse({ status: 200, type: [UsageRecordResponseDto] })
  async byCall(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("callId", ParseUUIDPipe) callId: string,
  ): Promise<UsageRecordResponseDto[]> {
    const records = await this.getCallUsageUseCase.execute(principal.tenantId, callId);
    return records.map((record) => UsageRecordResponseDto.fromDomain(record));
  }
}
