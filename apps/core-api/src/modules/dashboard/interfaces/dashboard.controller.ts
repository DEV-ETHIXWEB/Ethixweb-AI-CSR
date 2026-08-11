import { Controller, Get, Query } from "@nestjs/common";
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
import { GetDashboardHealthUseCase } from "../application/get-dashboard-health.use-case";
import { GetDashboardOverviewUseCase } from "../application/get-dashboard-overview.use-case";
import { ListDashboardEmergenciesUseCase } from "../application/list-dashboard-emergencies.use-case";
import { DashboardEmergenciesResponseDto } from "./dto/dashboard-emergencies-response.dto";
import { DashboardHealthResponseDto } from "./dto/dashboard-health-response.dto";
import { DashboardOverviewResponseDto } from "./dto/dashboard-overview-response.dto";

/**
 * Dispatcher/owner/admin-facing dashboard composition surface — the only
 * controller in this codebase with `@Roles("owner", "admin", "dispatcher")`
 * on a non-emergency-rules module, matching LeadsController's own role list
 * (a dispatcher needs the same operational visibility a lead inbox
 * gives them). No `viewer` — see docs/08-security-observability-reliability.md
 * §1.1's role list, `viewer` is intentionally excluded from every
 * operational surface in this codebase, not just this one.
 */
@ApiBearerAuth("bearer")
@ApiSecurity("api-key")
@ApiTags("dashboard")
@Roles("owner", "admin", "dispatcher")
@Controller("dashboard")
export class DashboardController {
  constructor(
    private readonly getDashboardOverviewUseCase: GetDashboardOverviewUseCase,
    private readonly listDashboardEmergenciesUseCase: ListDashboardEmergenciesUseCase,
    private readonly getDashboardHealthUseCase: GetDashboardHealthUseCase,
  ) {}

  @Get("overview")
  @ApiQuery({ name: "businessId", required: true })
  @ApiOperation({
    summary:
      "Composed operational snapshot for a business — calls, leads, capacity, usage, integration status",
  })
  @ApiResponse({ status: 200, type: DashboardOverviewResponseDto })
  async overview(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query("businessId") businessId: string,
  ): Promise<DashboardOverviewResponseDto> {
    const overview = await this.getDashboardOverviewUseCase.execute(principal.tenantId, businessId);
    return DashboardOverviewResponseDto.fromDomain(overview);
  }

  @Get("emergencies")
  @ApiQuery({ name: "businessId", required: true })
  @ApiOperation({
    summary:
      "Historical emergency escalations for a business — currently always empty, see ListDashboardEmergenciesUseCase's own comment for the documented schema gap",
  })
  @ApiResponse({ status: 200, type: DashboardEmergenciesResponseDto })
  async emergencies(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query("businessId") businessId: string,
  ): Promise<DashboardEmergenciesResponseDto> {
    const result = await this.listDashboardEmergenciesUseCase.execute(
      principal.tenantId,
      businessId,
    );
    return DashboardEmergenciesResponseDto.fromDomain(result);
  }

  @Get("health")
  @ApiOperation({
    summary:
      "Component health snapshot — only `database` is genuinely observed from core-api; every other component is unknown by design (see GetDashboardHealthUseCase's own comment)",
  })
  @ApiResponse({ status: 200, type: DashboardHealthResponseDto })
  async health(): Promise<DashboardHealthResponseDto> {
    const health = await this.getDashboardHealthUseCase.execute();
    return DashboardHealthResponseDto.fromDomain(health);
  }
}
