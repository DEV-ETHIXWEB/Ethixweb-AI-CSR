import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiSecurity, ApiTags } from "@nestjs/swagger";
import { CurrentPrincipal } from "../../../shared/auth/current-principal.decorator";
import { Roles } from "../../../shared/auth/roles.decorator";
import type { AuthPrincipal } from "../../../shared/auth/request-principal";
import { CreateCustomerUseCase } from "../application/create-customer.use-case";
import { CreateLeadUseCase } from "../application/create-lead.use-case";
import { SearchCustomerUseCase } from "../application/search-customer.use-case";
import { CreateCustomerDto } from "./dto/create-customer.dto";
import { CreateLeadDto } from "./dto/create-lead.dto";
import { CustomerResultResponseDto } from "./dto/customer-result-response.dto";
import { LeadResultResponseDto } from "./dto/lead-result-response.dto";
import { SearchCustomerDto } from "./dto/search-customer.dto";

/**
 * The adapter-level sync operations (docs/05-crm-integration.md §4) —
 * every call here always goes through `integrationId`, itself always
 * resolved against the caller's own tenant (the use-cases underneath run
 * inside a tenant-scoped transaction and re-verify ownership, the same
 * defense-in-depth as every other tenant-scoped lookup in this codebase),
 * never a client-suppliable tenantId.
 */
@ApiBearerAuth("bearer")
@ApiSecurity("api-key")
@ApiTags("crm-sync")
@Roles("owner", "admin", "dispatcher")
@Controller("crm")
export class CrmSyncController {
  constructor(
    private readonly searchCustomerUseCase: SearchCustomerUseCase,
    private readonly createCustomerUseCase: CreateCustomerUseCase,
    private readonly createLeadUseCase: CreateLeadUseCase,
  ) {}

  @Post("customers/search")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Search the connected CRM for a customer by phone — the required first step before createCustomer (docs/05 §4)",
  })
  @ApiResponse({
    status: 200,
    description: "Match found, or null if none",
    type: CustomerResultResponseDto,
  })
  @ApiResponse({ status: 404, description: "No such integration for the caller's tenant" })
  async searchCustomer(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() dto: SearchCustomerDto,
  ): Promise<CustomerResultResponseDto | null> {
    const result = await this.searchCustomerUseCase.execute({
      tenantId: principal.tenantId,
      integrationId: dto.integrationId,
      phoneE164: dto.phoneE164,
    });
    return result ? CustomerResultResponseDto.fromDomain(result) : null;
  }

  @Post("customers")
  @ApiOperation({
    summary:
      "Create a customer in the connected CRM — callers are expected to have already searched (docs/05 §4)",
  })
  @ApiResponse({ status: 201, description: "Customer created", type: CustomerResultResponseDto })
  @ApiResponse({ status: 404, description: "No such integration for the caller's tenant" })
  @ApiResponse({
    status: 409,
    description: "A request with the same idempotencyKey is already in progress",
  })
  async createCustomer(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() dto: CreateCustomerDto,
  ): Promise<CustomerResultResponseDto> {
    const result = await this.createCustomerUseCase.execute({
      tenantId: principal.tenantId,
      integrationId: dto.integrationId,
      name: dto.name,
      phoneE164: dto.phoneE164,
      email: dto.email,
      address: dto.address,
      idempotencyKey: dto.idempotencyKey,
    });
    return CustomerResultResponseDto.fromDomain(result);
  }

  @Post("leads")
  @ApiOperation({
    summary:
      "Create a lead in the connected CRM — never dispatches a technician or reserves a calendar slot (docs/05 §3)",
  })
  @ApiResponse({ status: 201, description: "Lead created", type: LeadResultResponseDto })
  @ApiResponse({ status: 404, description: "No such integration for the caller's tenant" })
  @ApiResponse({
    status: 409,
    description: "A request with the same idempotencyKey is already in progress",
  })
  async createLead(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() dto: CreateLeadDto,
  ): Promise<LeadResultResponseDto> {
    const result = await this.createLeadUseCase.execute({
      tenantId: principal.tenantId,
      integrationId: dto.integrationId,
      crmCustomerId: dto.crmCustomerId,
      problemSummary: dto.problemSummary,
      priority: dto.priority,
      leadType: dto.leadType,
      idempotencyKey: dto.idempotencyKey,
    });
    return LeadResultResponseDto.fromDomain(result);
  }
}
