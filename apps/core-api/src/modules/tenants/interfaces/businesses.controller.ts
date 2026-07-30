import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiSecurity, ApiTags } from "@nestjs/swagger";
import { CurrentPrincipal } from "../../../shared/auth/current-principal.decorator";
import { Roles } from "../../../shared/auth/roles.decorator";
import type { AuthPrincipal } from "../../../shared/auth/request-principal";
import { CreateBusinessUseCase } from "../application/create-business.use-case";
import { GetBusinessUseCase } from "../application/get-business.use-case";
import { ListBusinessesUseCase } from "../application/list-businesses.use-case";
import { UpdateBusinessUseCase } from "../application/update-business.use-case";
import { BusinessResponseDto } from "./dto/business-response.dto";
import { CreateBusinessDto } from "./dto/create-business.dto";
import { UpdateBusinessDto } from "./dto/update-business.dto";

/**
 * Routes are `/businesses`, not `/tenants/:tenantId/businesses` — changed
 * during the `auth` module's build-out (docs/20-architecture-decision-records.md
 * has no ADR for this specifically since it's a routing detail, not a data
 * model or infra decision, but the reasoning is recorded here since it's a
 * real change from how this controller originally shipped): before `auth`
 * existed, `tenantId` had to come from somewhere, and the URL was the only
 * option. Now that a request carries an authenticated principal with its
 * own `tenantId`, keeping a second, client-suppliable `tenantId` in the URL
 * would only ever be a spoofing attempt to check for and reject — simpler,
 * and structurally safer, to never accept it as input at all. "My own
 * tenant's businesses" is the only meaning this endpoint has ever had.
 */
@ApiBearerAuth("bearer")
@ApiSecurity("api-key")
@ApiTags("businesses")
@Controller("businesses")
export class BusinessesController {
  constructor(
    private readonly createBusinessUseCase: CreateBusinessUseCase,
    private readonly getBusinessUseCase: GetBusinessUseCase,
    private readonly listBusinessesUseCase: ListBusinessesUseCase,
    private readonly updateBusinessUseCase: UpdateBusinessUseCase,
  ) {}

  @Roles("owner", "admin")
  @Post()
  @ApiOperation({
    summary:
      "Create a business under the caller's own tenant — docs/01-architecture-overview.md §10",
  })
  @ApiResponse({ status: 201, description: "Business created", type: BusinessResponseDto })
  @ApiResponse({ status: 403, description: "Caller lacks owner/admin" })
  @ApiResponse({
    status: 404,
    description:
      "The caller's own tenant doesn't exist (should not happen for an authenticated caller)",
  })
  async create(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() dto: CreateBusinessDto,
  ): Promise<BusinessResponseDto> {
    const business = await this.createBusinessUseCase.execute({
      tenantId: principal.tenantId,
      ...dto,
    });
    return BusinessResponseDto.fromDomain(business);
  }

  @Get()
  @ApiOperation({ summary: "List the caller's own tenant's businesses" })
  @ApiResponse({
    status: 200,
    description: "The caller's tenant's businesses",
    type: [BusinessResponseDto],
  })
  async list(@CurrentPrincipal() principal: AuthPrincipal): Promise<BusinessResponseDto[]> {
    const businesses = await this.listBusinessesUseCase.execute(principal.tenantId);
    return businesses.map((business) => BusinessResponseDto.fromDomain(business));
  }

  @Get(":businessId")
  @ApiOperation({ summary: "Fetch one of the caller's own tenant's businesses by id" })
  @ApiResponse({ status: 200, description: "The business", type: BusinessResponseDto })
  @ApiResponse({
    status: 404,
    description:
      "No such business for the caller's tenant (also returned for another tenant's business id)",
  })
  async findOne(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("businessId", ParseUUIDPipe) businessId: string,
  ): Promise<BusinessResponseDto> {
    const business = await this.getBusinessUseCase.execute(principal.tenantId, businessId);
    return BusinessResponseDto.fromDomain(business);
  }

  @Roles("owner", "admin")
  @Patch(":businessId")
  @ApiOperation({
    summary:
      "Rename / re-timezone one of the caller's own tenant's businesses — owner/admin only. CRM type is not editable here (see UpdateBusinessUseCase).",
  })
  @ApiResponse({ status: 200, description: "Business updated", type: BusinessResponseDto })
  @ApiResponse({ status: 403, description: "Caller lacks owner/admin" })
  @ApiResponse({
    status: 404,
    description:
      "No such business for the caller's tenant (also returned for another tenant's business id)",
  })
  async update(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("businessId", ParseUUIDPipe) businessId: string,
    @Body() dto: UpdateBusinessDto,
  ): Promise<BusinessResponseDto> {
    const business = await this.updateBusinessUseCase.execute(principal.tenantId, businessId, dto);
    return BusinessResponseDto.fromDomain(business);
  }
}
