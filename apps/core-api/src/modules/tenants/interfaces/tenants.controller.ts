import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiSecurity, ApiTags } from "@nestjs/swagger";
import { CurrentPrincipal } from "../../../shared/auth/current-principal.decorator";
import { Public } from "../../../shared/auth/public.decorator";
import { Roles } from "../../../shared/auth/roles.decorator";
import type { AuthPrincipal } from "../../../shared/auth/request-principal";
import { CreateTenantUseCase } from "../application/create-tenant.use-case";
import { GetTenantUseCase } from "../application/get-tenant.use-case";
import { TransitionTenantStatusUseCase } from "../application/transition-tenant-status.use-case";
import { UpdateTenantUseCase } from "../application/update-tenant.use-case";
import { TenantNotFoundError } from "../domain/errors";
import { CreateTenantDto } from "./dto/create-tenant.dto";
import { TenantResponseDto } from "./dto/tenant-response.dto";
import { TransitionTenantStatusDto } from "./dto/transition-tenant-status.dto";
import { UpdateTenantDto } from "./dto/update-tenant.dto";

@ApiBearerAuth("bearer")
@ApiSecurity("api-key")
@ApiTags("tenants")
@Controller("tenants")
export class TenantsController {
  constructor(
    private readonly createTenantUseCase: CreateTenantUseCase,
    private readonly getTenantUseCase: GetTenantUseCase,
    private readonly transitionTenantStatusUseCase: TransitionTenantStatusUseCase,
    private readonly updateTenantUseCase: UpdateTenantUseCase,
  ) {}

  // ACKNOWLEDGED, UNRESOLVED GAP — flagged explicitly rather than hidden:
  // this is tenant *signup*, so by definition no authenticated principal
  // for "the tenant being created" can exist yet, and this platform has no
  // separate platform-admin auth tier to gate it with instead (RBAC roles
  // in docs/08-security-observability-reliability.md §1.1 are all
  // tenant-scoped: owner/admin/dispatcher/viewer, none of them "Ethixweb
  // staff"). `@Public()` is required for this to be callable at all right
  // now. Phase 1 onboarding is manual/ops-driven
  // (docs/15-tenant-lifecycle-billing-and-analytics.md §1) — until a
  // platform-admin auth tier exists, this endpoint MUST be protected at
  // the network/infra layer (VPC-internal only, or an IP allowlist), not
  // left reachable from the public internet. Tracked as a real, named
  // follow-up, not silently deferred.
  @Public()
  @Post()
  @ApiOperation({
    summary: "Create a new tenant — docs/15-tenant-lifecycle-billing-and-analytics.md §1",
    description:
      "UNAUTHENTICATED — see the code comment on this handler. Must be network-restricted until a " +
      "platform-admin auth tier exists.",
  })
  @ApiResponse({ status: 201, description: "Tenant created", type: TenantResponseDto })
  @ApiResponse({ status: 422, description: "Validation failure (e.g. name out of bounds)" })
  async create(@Body() dto: CreateTenantDto): Promise<TenantResponseDto> {
    const tenant = await this.createTenantUseCase.execute(dto);
    return TenantResponseDto.fromDomain(tenant);
  }

  @Get(":id")
  @ApiOperation({ summary: "Fetch a tenant by id — the caller's own tenant only" })
  @ApiResponse({ status: 200, description: "The tenant", type: TenantResponseDto })
  @ApiResponse({
    status: 404,
    description: "No such tenant, or it belongs to a different caller (never distinguished)",
  })
  async findOne(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<TenantResponseDto> {
    this.assertOwnTenant(principal, id);
    const tenant = await this.getTenantUseCase.execute(id);
    return TenantResponseDto.fromDomain(tenant);
  }

  @Roles("owner", "admin")
  @Patch(":id")
  @ApiOperation({
    summary:
      "Rename the caller's own tenant — owner/admin only. Plan tier is not editable here (see UpdateTenantUseCase).",
  })
  @ApiResponse({ status: 200, description: "Tenant updated", type: TenantResponseDto })
  @ApiResponse({ status: 403, description: "Caller lacks owner/admin" })
  @ApiResponse({ status: 404, description: "No such tenant, or it belongs to a different caller" })
  async update(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateTenantDto,
  ): Promise<TenantResponseDto> {
    this.assertOwnTenant(principal, id);
    const tenant = await this.updateTenantUseCase.execute(id, dto);
    return TenantResponseDto.fromDomain(tenant);
  }

  @Roles("owner")
  @Patch(":id/status")
  @ApiOperation({
    summary:
      "Transition tenant lifecycle status — docs/15-tenant-lifecycle-billing-and-analytics.md §2. Owner only: billing/tenant-level, per docs/08 §1.1.",
  })
  @ApiResponse({ status: 200, description: "Status transitioned", type: TenantResponseDto })
  @ApiResponse({ status: 403, description: "Caller is not an owner" })
  @ApiResponse({ status: 404, description: "No such tenant, or it belongs to a different caller" })
  @ApiResponse({
    status: 409,
    description:
      "Illegal transition against the lifecycle graph, or a concurrent transition already moved the tenant off the expected status (see ConcurrentTenantModificationError) — retry after re-fetching",
  })
  async transitionStatus(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: TransitionTenantStatusDto,
  ): Promise<TenantResponseDto> {
    this.assertOwnTenant(principal, id);
    const tenant = await this.transitionTenantStatusUseCase.execute(id, dto.status);
    return TenantResponseDto.fromDomain(tenant);
  }

  /**
   * A caller with a valid principal for tenant A must never be able to
   * read or manage tenant B by guessing/enumerating a different :id — this
   * check is what enforces that, since RLS itself doesn't apply here
   * (`tenants` has no RLS policy at all, per docs/20 ADR-013). Deliberately
   * `TenantNotFoundError` (404), not a distinct "forbidden" error: a
   * mismatched id shouldn't confirm to an unauthorized caller that the
   * other tenant even exists.
   */
  private assertOwnTenant(principal: AuthPrincipal, requestedTenantId: string): void {
    if (principal.tenantId !== requestedTenantId) {
      throw new TenantNotFoundError(requestedTenantId);
    }
  }
}
