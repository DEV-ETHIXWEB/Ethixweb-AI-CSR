import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, MaxLength, ValidateIf } from "class-validator";
import type { CrmCredential } from "../../domain/crm-credential";

export const CRM_CREDENTIAL_TYPES = ["api_key", "oauth"] as const;

// Generous headroom over any real API key/token/URL/secret while still
// bounding unvalidated free-text input before it's encrypted and stored —
// same reasoning as every other MaxLength bound in this codebase.
const MAX_SECRET_LENGTH = 2048;
const MAX_URL_LENGTH = 500;

export class CrmCredentialDto {
  @ApiProperty({ enum: CRM_CREDENTIAL_TYPES })
  @IsIn(CRM_CREDENTIAL_TYPES)
  type!: (typeof CRM_CREDENTIAL_TYPES)[number];

  @ApiPropertyOptional({ description: "Required when type is api_key" })
  @ValidateIf((dto: CrmCredentialDto) => dto.type === "api_key")
  @IsString()
  @MaxLength(MAX_SECRET_LENGTH)
  apiKey?: string;

  @ApiPropertyOptional({ description: "Required when type is oauth" })
  @ValidateIf((dto: CrmCredentialDto) => dto.type === "oauth")
  @IsString()
  @MaxLength(MAX_SECRET_LENGTH)
  accessToken?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SECRET_LENGTH)
  refreshToken?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  expiresAt?: string;

  @ApiPropertyOptional({
    description: "Overrides the adapter's default API base URL, e.g. for a sandbox account",
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_URL_LENGTH)
  baseUrl?: string;

  @ApiPropertyOptional({
    description: "The signing secret HCP (or another CRM) issued when the webhook was registered",
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SECRET_LENGTH)
  webhookSigningSecret?: string;

  /**
   * `@ValidateIf` above already guarantees `apiKey`/`accessToken` are
   * present for their respective `type` at runtime — this narrows the DTO
   * (a flat class, not a real discriminated union at the type level) into
   * the domain's actual `CrmCredential` union once, here, rather than every
   * caller needing its own non-null assertion.
   */
  toDomain(): CrmCredential {
    if (this.type === "api_key") {
      return {
        type: "api_key",
        apiKey: this.apiKey as string,
        baseUrl: this.baseUrl,
        webhookSigningSecret: this.webhookSigningSecret,
      };
    }
    return {
      type: "oauth",
      accessToken: this.accessToken as string,
      refreshToken: this.refreshToken,
      expiresAt: this.expiresAt,
      baseUrl: this.baseUrl,
      webhookSigningSecret: this.webhookSigningSecret,
    };
  }
}
