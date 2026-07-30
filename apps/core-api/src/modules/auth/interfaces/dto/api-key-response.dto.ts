import { ApiProperty } from "@nestjs/swagger";
import type { ApiKey } from "../../domain/api-key.entity";
import type { CreateApiKeyResult } from "../../application/commands/create-api-key.use-case";

/** Never includes `keyHash` — its input type doesn't carry it, so this DTO structurally cannot leak it. */
export class ApiKeyResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() tenantId: string;
  @ApiProperty() scopes: string;
  @ApiProperty({ nullable: true }) expiresAt: Date | null;
  @ApiProperty({ nullable: true }) revokedAt: Date | null;
  @ApiProperty() createdAt: Date;

  private constructor(apiKey: ApiKey) {
    this.id = apiKey.id;
    this.tenantId = apiKey.tenantId;
    this.scopes = apiKey.scopes;
    this.expiresAt = apiKey.expiresAt;
    this.revokedAt = apiKey.revokedAt;
    this.createdAt = apiKey.createdAt;
  }

  static fromDomain(apiKey: ApiKey): ApiKeyResponseDto {
    return new ApiKeyResponseDto(apiKey);
  }
}

/** Only ever returned once, from the create endpoint — includes the plaintext key. */
export class CreatedApiKeyResponseDto {
  @ApiProperty() id: string;
  @ApiProperty({ description: "Shown exactly once. Store it now — it cannot be retrieved again." })
  plaintextKey: string;
  @ApiProperty() scopes: string;
  @ApiProperty({ nullable: true }) expiresAt: Date | null;
  @ApiProperty() createdAt: Date;

  private constructor(result: CreateApiKeyResult) {
    this.id = result.id;
    this.plaintextKey = result.plaintextKey;
    this.scopes = result.scopes;
    this.expiresAt = result.expiresAt;
    this.createdAt = result.createdAt;
  }

  static fromResult(result: CreateApiKeyResult): CreatedApiKeyResponseDto {
    return new CreatedApiKeyResponseDto(result);
  }
}
