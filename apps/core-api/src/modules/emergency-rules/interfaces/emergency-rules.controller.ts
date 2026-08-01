import { Body, Controller, Get, Inject, Post, Query } from "@nestjs/common";
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
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import {
  EMERGENCY_RULE_REPOSITORY,
  type EmergencyRuleRepository,
} from "../domain/ports/emergency-rule-repository.port";
import { GetBusinessHoursUseCase } from "../application/get-business-hours.use-case";
import { CreateEmergencyRuleDto } from "./dto/create-emergency-rule.dto";
import { EmergencyRuleResponseDto } from "./dto/emergency-rule-response.dto";
import { BusinessHoursResponseDto } from "./dto/business-hours-response.dto";

/**
 * Dispatcher-facing configuration surface. docs/13 `emergency-rules`
 * module §6: "Admin dashboard CRUD... Phase 2 for full self-service UI;
 * Phase 1 can be config-file/seed-script driven for the pilot tenant" —
 * accordingly this is list + create only, not full CRUD, matching what's
 * actually asked for at this phase.
 */
@ApiBearerAuth("bearer")
@ApiSecurity("api-key")
@ApiTags("emergency-rules")
@Roles("owner", "admin")
@Controller("emergency-rules")
export class EmergencyRulesController {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(EMERGENCY_RULE_REPOSITORY)
    private readonly emergencyRuleRepository: EmergencyRuleRepository,
    private readonly getBusinessHoursUseCase: GetBusinessHoursUseCase,
  ) {}

  @Get()
  @ApiQuery({ name: "businessId", required: true })
  @ApiOperation({ summary: "List active emergency rules configured for a business" })
  @ApiResponse({ status: 200, type: [EmergencyRuleResponseDto] })
  async list(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query("businessId") businessId: string,
  ): Promise<EmergencyRuleResponseDto[]> {
    const rules = await this.tenantContext.run(principal.tenantId, (db) =>
      this.emergencyRuleRepository.listActiveByBusiness(db, principal.tenantId, businessId),
    );
    return rules.map((rule) => EmergencyRuleResponseDto.fromDomain(rule));
  }

  @Post()
  @ApiOperation({
    summary:
      "Add a business-specific emergency rule (overrides/extends the platform default keyword set)",
  })
  @ApiResponse({ status: 201, type: EmergencyRuleResponseDto })
  async create(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() dto: CreateEmergencyRuleDto,
  ): Promise<EmergencyRuleResponseDto> {
    const rule = await this.tenantContext.run(principal.tenantId, (db) =>
      this.emergencyRuleRepository.create(db, {
        tenantId: principal.tenantId,
        businessId: dto.businessId,
        keywordOrPattern: dto.keywordOrPattern,
        severity: dto.severity,
        escalationAction: dto.escalationAction,
      }),
    );
    return EmergencyRuleResponseDto.fromDomain(rule);
  }

  @Get("business-hours")
  @ApiQuery({ name: "businessId", required: true })
  @ApiOperation({ summary: "Current open/closed status for a business" })
  @ApiResponse({ status: 200, type: BusinessHoursResponseDto })
  async businessHours(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query("businessId") businessId: string,
  ): Promise<BusinessHoursResponseDto> {
    const result = await this.getBusinessHoursUseCase.execute(principal.tenantId, businessId);
    return BusinessHoursResponseDto.fromDomain(result);
  }
}
