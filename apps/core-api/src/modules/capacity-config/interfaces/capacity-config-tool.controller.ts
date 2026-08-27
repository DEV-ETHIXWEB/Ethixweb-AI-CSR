import { Controller, Get, Param, ParseUUIDPipe } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiSecurity, ApiTags } from "@nestjs/swagger";
import { CurrentPrincipal } from "../../../shared/auth/current-principal.decorator";
import type { AuthPrincipal } from "../../../shared/auth/request-principal";
import { GetCapacityConfigUseCase } from "../application/get-capacity-config.use-case";
import { CapacityConfigResponseDto } from "./dto/capacity-config-response.dto";

/**
 * voice-orchestrator's HttpCapacityConfigProvider reads this — role-
 * unrestricted, API-key-only, matching UsageToolController's exact
 * pattern. Same use case, same response shape as the dashboard's GET
 * (defaults-if-absent, never 404).
 */
@ApiBearerAuth("bearer")
@ApiSecurity("api-key")
@ApiTags("internal-tools")
@Controller("internal/capacity-config")
export class CapacityConfigToolController {
  constructor(private readonly getCapacityConfigUseCase: GetCapacityConfigUseCase) {}

  @Get(":businessId")
  @ApiOperation({
    summary:
      "docs/36 — capacity/brochure policy for a business, tool-broker/runtime-facing, API-key auth only",
  })
  @ApiResponse({ status: 200, type: CapacityConfigResponseDto })
  async get(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("businessId", ParseUUIDPipe) businessId: string,
  ): Promise<CapacityConfigResponseDto> {
    const result = await this.getCapacityConfigUseCase.execute(principal.tenantId, businessId);
    return CapacityConfigResponseDto.fromDomain(result);
  }
}
