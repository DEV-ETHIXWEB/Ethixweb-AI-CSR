import { Body, Controller, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiSecurity, ApiTags } from "@nestjs/swagger";
import { CurrentPrincipal } from "../../../shared/auth/current-principal.decorator";
import type { AuthPrincipal } from "../../../shared/auth/request-principal";
import { CreateCustomerUseCase } from "../application/create-customer.use-case";
import { ResolveCustomerUseCase } from "../application/resolve-customer.use-case";
import { CreateCustomerToolDto } from "./dto/create-customer-tool.dto";
import { CustomerResponseDto } from "./dto/customer-response.dto";
import { ResolveCustomerToolDto } from "./dto/resolve-customer-tool.dto";

/**
 * The tool broker's execution surface for docs/04-ai-tool-architecture.md
 * §3.1 (`searchCustomer`) and §3.2 (`createCustomer`) — a SEPARATE
 * controller from the dispatcher-facing CustomersController (not just
 * different routes on the same one) deliberately: per RolesGuard's own
 * comment, a `@Roles(...)`-gated route is JWT-only by design, and this
 * controller's only caller is the voice-orchestrator service authenticating
 * with a per-tenant API key, which RolesGuard would reject outright.
 * Leaving this controller role-UNRESTRICTED (no `@Roles()` at all) is
 * intentional, not an oversight — see RolesGuard's own comment: "routes
 * without it are role-unrestricted (any authenticated principal may
 * proceed; per-tenant scoping still applies via principal.tenantId)".
 * These endpoints do exactly what ResolveCustomerUseCase/
 * CreateCustomerUseCase already do for the dispatcher UI — no new business
 * logic, just a second, narrower authentication surface for a non-human
 * caller.
 */
@ApiBearerAuth("bearer")
@ApiSecurity("api-key")
@ApiTags("internal-tools")
@Controller("internal/customers")
export class CustomersToolController {
  constructor(
    private readonly resolveCustomerUseCase: ResolveCustomerUseCase,
    private readonly createCustomerUseCase: CreateCustomerUseCase,
  ) {}

  @Post("resolve")
  @ApiOperation({
    summary: "docs/04 §3.1 searchCustomer — tool-broker-facing, API-key auth only",
  })
  @ApiResponse({
    status: 200,
    description: "Match found, or null if none",
    type: CustomerResponseDto,
  })
  async resolve(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() dto: ResolveCustomerToolDto,
  ): Promise<CustomerResponseDto | null> {
    const customer = await this.resolveCustomerUseCase.execute({
      tenantId: principal.tenantId,
      businessId: dto.businessId,
      phoneE164: dto.phoneE164,
    });
    return customer ? CustomerResponseDto.fromDomain(customer) : null;
  }

  @Post()
  @ApiOperation({
    summary: "docs/04 §3.2 createCustomer — tool-broker-facing, API-key auth only",
  })
  @ApiResponse({ status: 201, description: "Customer created", type: CustomerResponseDto })
  async create(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() dto: CreateCustomerToolDto,
  ): Promise<CustomerResponseDto> {
    const customer = await this.createCustomerUseCase.execute({
      tenantId: principal.tenantId,
      businessId: dto.businessId,
      name: dto.name,
      phoneE164: dto.phoneE164,
      email: dto.email,
      address: dto.address,
    });
    return CustomerResponseDto.fromDomain(customer);
  }
}
