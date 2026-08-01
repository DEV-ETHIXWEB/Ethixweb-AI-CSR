import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from "@nestjs/swagger";
import { CurrentPrincipal } from "../../../shared/auth/current-principal.decorator";
import type { AuthPrincipal } from "../../../shared/auth/request-principal";
import { EscalateEmergencyUseCase } from "../application/escalate-emergency.use-case";
import { GetBusinessHoursUseCase } from "../application/get-business-hours.use-case";
import { BusinessHoursResponseDto } from "./dto/business-hours-response.dto";
import { EscalateEmergencyResponseDto } from "./dto/escalate-emergency-response.dto";
import { EscalateEmergencyToolDto } from "./dto/escalate-emergency-tool.dto";

/**
 * The tool broker's execution surface for docs/04 §3.6 (`getBusinessHours`)
 * and §3.8 (`escalateEmergency`) — role-unrestricted, API-key-only, same
 * pattern and same reasoning as CustomersToolController/LeadsToolController
 * (see either's own comment). Closes the Technical Debt item flagged in
 * the Voice AI Orchestrator's own build: these two tools previously
 * returned a hardcoded documented-fallback response because no backing
 * module existed; this controller IS that backing module now.
 */
@ApiBearerAuth("bearer")
@ApiSecurity("api-key")
@ApiTags("internal-tools")
@Controller("internal/emergency-rules")
export class EmergencyRulesToolController {
  constructor(
    private readonly escalateEmergencyUseCase: EscalateEmergencyUseCase,
    private readonly getBusinessHoursUseCase: GetBusinessHoursUseCase,
  ) {}

  @Post("escalate")
  @ApiOperation({
    summary: "docs/04 §3.8 escalateEmergency — tool-broker-facing, API-key auth only",
  })
  @ApiResponse({ status: 200, type: EscalateEmergencyResponseDto })
  async escalate(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() dto: EscalateEmergencyToolDto,
  ): Promise<EscalateEmergencyResponseDto> {
    const result = await this.escalateEmergencyUseCase.execute({
      tenantId: principal.tenantId,
      businessId: dto.businessId,
      callId: dto.callId,
      description: dto.description,
      detectedKeywords: dto.detectedKeywords,
    });
    return EscalateEmergencyResponseDto.fromDomain(result);
  }

  @Get("business-hours")
  @ApiQuery({ name: "businessId", required: true })
  @ApiOperation({
    summary: "docs/04 §3.6 getBusinessHours — tool-broker-facing, API-key auth only",
  })
  @ApiResponse({ status: 200, type: BusinessHoursResponseDto })
  async businessHours(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query("businessId") businessId: string,
  ): Promise<BusinessHoursResponseDto> {
    const result = await this.getBusinessHoursUseCase.execute(principal.tenantId, businessId);
    return BusinessHoursResponseDto.fromDomain(result);
  }
}
