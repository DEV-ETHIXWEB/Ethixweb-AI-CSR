import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
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
import { CreateCustomerUseCase } from "../application/create-customer.use-case";
import { GetCustomerUseCase } from "../application/get-customer.use-case";
import { ListCustomersUseCase } from "../application/list-customers.use-case";
import { ResolveCustomerUseCase } from "../application/resolve-customer.use-case";
import { CreateCustomerDto } from "./dto/create-customer.dto";
import { CustomerResponseDto } from "./dto/customer-response.dto";
import { ListCustomersQueryDto } from "./dto/list-customers-query.dto";
import { PaginatedCustomersResponseDto } from "./dto/paginated-customers-response.dto";
import { ResolveCustomerDto } from "./dto/resolve-customer.dto";

/**
 * Always scoped to the caller's own tenant, derived from the authenticated
 * principal — never a client-supplied tenantId, matching every other
 * tenant-scoped controller in this codebase. Owner/admin/dispatcher: this
 * is operational data a dispatcher looks up during normal call handling,
 * not an admin-only concern (same reasoning as CrmSyncController's roles).
 */
@ApiBearerAuth("bearer")
@ApiSecurity("api-key")
@ApiTags("customers")
@Roles("owner", "admin", "dispatcher")
@Controller("customers")
export class CustomersController {
  constructor(
    private readonly resolveCustomerUseCase: ResolveCustomerUseCase,
    private readonly createCustomerUseCase: CreateCustomerUseCase,
    private readonly getCustomerUseCase: GetCustomerUseCase,
    private readonly listCustomersUseCase: ListCustomersUseCase,
  ) {}

  @Post("resolve")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Resolve a customer by phone for one of the caller's businesses — local cache check, falling back to a CRM search and cache write-back (docs/13 customers module §3)",
  })
  @ApiResponse({
    status: 200,
    description: "Match found, or null if none",
    type: CustomerResponseDto,
  })
  @ApiResponse({ status: 403, description: "Caller's role is not one of owner/admin/dispatcher" })
  @ApiResponse({
    status: 404,
    description: "No active CRM integration configured for this business",
  })
  async resolve(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() dto: ResolveCustomerDto,
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
    summary:
      "Create a customer for one of the caller's businesses — CRM adapter create, then a race-safe local cache write-back (docs/13 customers module §4)",
  })
  @ApiResponse({
    status: 201,
    description: "Customer created (or the existing row, if this raced with a concurrent create)",
    type: CustomerResponseDto,
  })
  @ApiResponse({ status: 403, description: "Caller's role is not one of owner/admin/dispatcher" })
  @ApiResponse({
    status: 404,
    description: "No active CRM integration configured for this business",
  })
  async create(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() dto: CreateCustomerDto,
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

  @Get()
  @ApiQuery({ name: "businessId", required: true })
  @ApiOperation({
    summary: "List customers for one of the caller's businesses, paginated and optionally filtered",
  })
  @ApiResponse({
    status: 200,
    description: "A page of customers",
    type: PaginatedCustomersResponseDto,
  })
  @ApiResponse({ status: 403, description: "Caller's role is not one of owner/admin/dispatcher" })
  async list(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query() query: ListCustomersQueryDto,
  ): Promise<PaginatedCustomersResponseDto> {
    const result = await this.listCustomersUseCase.execute({
      tenantId: principal.tenantId,
      businessId: query.businessId,
      page: query.page,
      pageSize: query.pageSize,
      search: query.search,
    });
    return PaginatedCustomersResponseDto.fromDomain(result);
  }

  @Get(":id")
  @ApiOperation({ summary: "Fetch one of the caller's own tenant's customers by id" })
  @ApiResponse({ status: 200, description: "The customer", type: CustomerResponseDto })
  @ApiResponse({ status: 403, description: "Caller's role is not one of owner/admin/dispatcher" })
  @ApiResponse({ status: 404, description: "No such customer for the caller's tenant" })
  async findOne(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<CustomerResponseDto> {
    const customer = await this.getCustomerUseCase.execute(principal.tenantId, id);
    return CustomerResponseDto.fromDomain(customer);
  }
}
