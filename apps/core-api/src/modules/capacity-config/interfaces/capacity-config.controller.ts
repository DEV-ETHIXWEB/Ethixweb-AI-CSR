import { Body, Controller, Get, Param, ParseUUIDPipe, Patch } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiSecurity, ApiTags } from "@nestjs/swagger";
import { CurrentPrincipal } from "../../../shared/auth/current-principal.decorator";
import { Roles } from "../../../shared/auth/roles.decorator";
import type { AuthPrincipal } from "../../../shared/auth/request-principal";
import { GetCapacityConfigUseCase } from "../application/get-capacity-config.use-case";
import { UpsertCapacityConfigUseCase } from "../application/upsert-capacity-config.use-case";
import { CapacityConfigResponseDto } from "./dto/capacity-config-response.dto";
import { UpsertCapacityConfigDto } from "./dto/upsert-capacity-config.dto";

/** Owner/admin-facing capacity/brochure policy configuration (docs/36). */
@ApiBearerAuth("bearer")
@ApiSecurity("api-key")
@ApiTags("capacity-config")
@Roles("owner", "admin")
@Controller("dashboard/capacity-config")
export class CapacityConfigController {
  constructor(
    private readonly getCapacityConfigUseCase: GetCapacityConfigUseCase,
    private readonly upsertCapacityConfigUseCase: UpsertCapacityConfigUseCase,
  ) {}

  @Get(":businessId")
  @ApiOperation({
    summary:
      "Current capacity/brochure policy for a business — platform defaults if never configured",
  })
  @ApiResponse({ status: 200, type: CapacityConfigResponseDto })
  async get(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("businessId", ParseUUIDPipe) businessId: string,
  ): Promise<CapacityConfigResponseDto> {
    const result = await this.getCapacityConfigUseCase.execute(principal.tenantId, businessId);
    return CapacityConfigResponseDto.fromDomain(result);
  }

  @Patch(":businessId")
  @ApiOperation({ summary: "Create or partially update a business's capacity/brochure policy" })
  @ApiResponse({ status: 200, type: CapacityConfigResponseDto })
  async upsert(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("businessId", ParseUUIDPipe) businessId: string,
    @Body() dto: UpsertCapacityConfigDto,
  ): Promise<CapacityConfigResponseDto> {
    const jwtPrincipal = principal as Extract<AuthPrincipal, { authType: "jwt" }>;
    const result = await this.upsertCapacityConfigUseCase.execute({
      tenantId: jwtPrincipal.tenantId,
      businessId,
      actorUserId: jwtPrincipal.userId,
      patch: {
        maxTenantConcurrentCalls: dto.maxTenantConcurrentCalls,
        maxWaitingCallers: dto.maxWaitingCallers,
        waitingTimeoutMs: dto.waitingTimeoutMs,
        emergencyHeadroomRatio: dto.emergencyHeadroomRatio,
        overflowNumber: dto.overflowNumber,
        brochureEnabled: dto.brochureEnabled,
        brochureRotationMs: dto.brochureRotationMs,
      },
    });
    return CapacityConfigResponseDto.fromDomain(result);
  }
}
