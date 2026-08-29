import { Controller, Get } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiSecurity, ApiTags } from "@nestjs/swagger";
import { CurrentPrincipal } from "../../../shared/auth/current-principal.decorator";
import type { AuthPrincipal } from "../../../shared/auth/request-principal";
import { GetTenantUseCase } from "../application/get-tenant.use-case";
import { TenantStatusResponseDto } from "./dto/tenant-status-response.dto";

/**
 * Closes a real, previously-unenforced gap: docs/15-tenant-lifecycle-billing-and-analytics.md
 * §2 documents that a `suspended` tenant's inbound calls must get an honest
 * message rather than "silently answering with a degraded/broken AI" — the
 * `tenants.status` state machine (TransitionTenantStatusUseCase) was fully
 * built and enforced, but nothing in the call path ever read it before this.
 * voice-orchestrator's HttpTenantStatusProvider reads this endpoint before
 * admitting a call — same role-unrestricted, API-key-only pattern as
 * CapacityConfigToolController. `tenantId` comes from the caller's own
 * API-key principal, not a URL param: this service's API key is already
 * scoped to exactly one tenant (see ApiKeysController's own comment), so
 * there is nothing else it could legitimately ask about.
 */
@ApiBearerAuth("bearer")
@ApiSecurity("api-key")
@ApiTags("internal-tools")
@Controller("internal/tenant-status")
export class TenantStatusToolController {
  constructor(private readonly getTenantUseCase: GetTenantUseCase) {}

  @Get()
  @ApiOperation({
    summary: "docs/15 §2 — the calling service's own tenant's current lifecycle status",
  })
  @ApiResponse({ status: 200, type: TenantStatusResponseDto })
  async get(@CurrentPrincipal() principal: AuthPrincipal): Promise<TenantStatusResponseDto> {
    const tenant = await this.getTenantUseCase.execute(principal.tenantId);
    return TenantStatusResponseDto.fromDomain(tenant.status);
  }
}
