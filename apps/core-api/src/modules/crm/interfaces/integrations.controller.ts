import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from "@nestjs/swagger";
import { IsUUID } from "class-validator";
import { CurrentPrincipal } from "../../../shared/auth/current-principal.decorator";
import { Roles } from "../../../shared/auth/roles.decorator";
import type { AuthPrincipal } from "../../../shared/auth/request-principal";
import { ConnectIntegrationUseCase } from "../application/connect-integration.use-case";
import { DisconnectIntegrationUseCase } from "../application/disconnect-integration.use-case";
import { GetIntegrationUseCase } from "../application/get-integration.use-case";
import { ListIntegrationsUseCase } from "../application/list-integrations.use-case";
import { VerifyIntegrationUseCase } from "../application/verify-integration.use-case";
import { ConnectIntegrationDto } from "./dto/connect-integration.dto";
import { IntegrationResponseDto } from "./dto/integration-response.dto";

class ListIntegrationsQueryDto {
  @IsUUID()
  businessId!: string;
}

/**
 * Always scoped to the caller's own tenant, derived from the authenticated
 * principal (never a client-supplied tenantId) — same discipline as every
 * other tenant-scoped controller in this codebase. Owner/admin only:
 * connecting/disconnecting a CRM integration grants this platform access
 * to the tenant's customer data in an external system, the same privilege
 * tier as inviting a teammate or issuing an API key.
 */
@ApiBearerAuth("bearer")
@ApiSecurity("api-key")
@ApiTags("crm-integrations")
@Roles("owner", "admin")
@Controller("integrations")
export class IntegrationsController {
  constructor(
    private readonly connectIntegrationUseCase: ConnectIntegrationUseCase,
    private readonly getIntegrationUseCase: GetIntegrationUseCase,
    private readonly listIntegrationsUseCase: ListIntegrationsUseCase,
    private readonly verifyIntegrationUseCase: VerifyIntegrationUseCase,
    private readonly disconnectIntegrationUseCase: DisconnectIntegrationUseCase,
  ) {}

  @Post()
  @ApiOperation({
    summary:
      "Connect a CRM integration for one of the caller's businesses — starts in pending_verification",
  })
  @ApiResponse({ status: 201, description: "Integration connected", type: IntegrationResponseDto })
  @ApiResponse({ status: 403, description: "Caller lacks owner/admin" })
  async connect(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() dto: ConnectIntegrationDto,
  ): Promise<IntegrationResponseDto> {
    const integration = await this.connectIntegrationUseCase.execute({
      tenantId: principal.tenantId,
      businessId: dto.businessId,
      crmType: dto.crmType,
      credential: dto.credential.toDomain(),
    });
    return IntegrationResponseDto.fromDomain(integration);
  }

  @Get()
  @ApiQuery({ name: "businessId", required: true })
  @ApiOperation({ summary: "List CRM integrations for one of the caller's own businesses" })
  @ApiResponse({
    status: 200,
    description: "The business's integrations",
    type: [IntegrationResponseDto],
  })
  async list(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query() query: ListIntegrationsQueryDto,
  ): Promise<IntegrationResponseDto[]> {
    const integrations = await this.listIntegrationsUseCase.execute(
      principal.tenantId,
      query.businessId,
    );
    return integrations.map((integration) => IntegrationResponseDto.fromDomain(integration));
  }

  @Get(":id")
  @ApiOperation({ summary: "Fetch one of the caller's own tenant's integrations by id" })
  @ApiResponse({ status: 200, description: "The integration", type: IntegrationResponseDto })
  @ApiResponse({ status: 404, description: "No such integration for the caller's tenant" })
  async findOne(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<IntegrationResponseDto> {
    const integration = await this.getIntegrationUseCase.execute(principal.tenantId, id);
    return IntegrationResponseDto.fromDomain(integration);
  }

  @Post(":id/verify")
  @ApiOperation({
    summary: "Test the stored credential against the CRM and update status/lastVerifiedAt",
  })
  @ApiResponse({
    status: 201,
    description: "Verified — status is now active",
    type: IntegrationResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: "Credential rejected by the CRM — status is now invalid_credentials",
  })
  @ApiResponse({ status: 404, description: "No such integration for the caller's tenant" })
  async verify(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<IntegrationResponseDto> {
    const integration = await this.verifyIntegrationUseCase.execute(principal.tenantId, id);
    return IntegrationResponseDto.fromDomain(integration);
  }

  @Delete(":id")
  @ApiOperation({
    summary: "Disconnect a CRM integration — flips status to disconnected, never deletes the row",
  })
  @ApiResponse({ status: 200, description: "Disconnected", type: IntegrationResponseDto })
  @ApiResponse({ status: 404, description: "No such integration for the caller's tenant" })
  async disconnect(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<IntegrationResponseDto> {
    const integration = await this.disconnectIntegrationUseCase.execute(principal.tenantId, id);
    return IntegrationResponseDto.fromDomain(integration);
  }
}
