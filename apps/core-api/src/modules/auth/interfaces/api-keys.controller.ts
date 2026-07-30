import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { CreateApiKeyUseCase } from "../application/commands/create-api-key.use-case";
import { RevokeApiKeyUseCase } from "../application/commands/revoke-api-key.use-case";
import { ListApiKeysUseCase } from "../application/queries/list-api-keys.use-case";
import { CurrentPrincipal } from "../../../shared/auth/current-principal.decorator";
import { Roles } from "../../../shared/auth/roles.decorator";
import type { AuthPrincipal } from "../../../shared/auth/request-principal";
import { ApiKeyResponseDto, CreatedApiKeyResponseDto } from "./dto/api-key-response.dto";
import { CreateApiKeyDto } from "./dto/create-api-key.dto";

/**
 * Always scoped to the caller's own tenant, derived from the authenticated
 * principal — never a client-supplied tenantId. Owner/admin only: API keys
 * grant programmatic access to a tenant's data, the same privilege tier as
 * inviting a teammate. `@Roles()` requires a JWT principal (an API key can
 * never satisfy it — see RolesGuard), so `@ApiBearerAuth` is the only
 * security scheme documented here, deliberately not `@ApiSecurity('api-key')`.
 */
@ApiBearerAuth("bearer")
@ApiTags("api-keys")
@Roles("owner", "admin")
@Controller("api-keys")
export class ApiKeysController {
  constructor(
    private readonly createApiKeyUseCase: CreateApiKeyUseCase,
    private readonly revokeApiKeyUseCase: RevokeApiKeyUseCase,
    private readonly listApiKeysUseCase: ListApiKeysUseCase,
  ) {}

  @Post()
  @ApiOperation({
    summary:
      "Create an API key for the caller's own tenant — the plaintext key is returned exactly once",
  })
  @ApiResponse({ status: 201, description: "Key created", type: CreatedApiKeyResponseDto })
  async create(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() dto: CreateApiKeyDto,
  ): Promise<CreatedApiKeyResponseDto> {
    const tenantId = jwtTenantId(principal);
    const result = await this.createApiKeyUseCase.execute({
      tenantId,
      scopes: dto.scopes,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
    });
    return CreatedApiKeyResponseDto.fromResult(result);
  }

  @Get()
  @ApiOperation({
    summary:
      "List the caller's own tenant's API keys — never returns the plaintext key or its hash",
  })
  @ApiResponse({
    status: 200,
    description: "The caller's tenant's API keys",
    type: [ApiKeyResponseDto],
  })
  async list(@CurrentPrincipal() principal: AuthPrincipal): Promise<ApiKeyResponseDto[]> {
    const tenantId = jwtTenantId(principal);
    const apiKeys = await this.listApiKeysUseCase.execute(tenantId);
    return apiKeys.map((apiKey) => ApiKeyResponseDto.fromDomain(apiKey));
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Revoke an API key belonging to the caller's own tenant" })
  @ApiResponse({ status: 204, description: "Revoked" })
  @ApiResponse({
    status: 404,
    description:
      "No such key for the caller's tenant (also returned for another tenant's key id — never confirms it exists)",
  })
  async revoke(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    const tenantId = jwtTenantId(principal);
    await this.revokeApiKeyUseCase.execute(tenantId, id);
  }
}

/** RolesGuard already guarantees a JWT-authenticated principal on every route here (see roles.guard.ts). */
function jwtTenantId(principal: AuthPrincipal): string {
  return principal.tenantId;
}
