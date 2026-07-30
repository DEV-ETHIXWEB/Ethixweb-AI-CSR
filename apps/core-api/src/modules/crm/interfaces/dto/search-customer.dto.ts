import { ApiProperty } from "@nestjs/swagger";
import { IsUUID, Matches } from "class-validator";
import { E164_PATTERN } from "../../../../shared/domain/e164";

// Re-exported for the sibling DTOs that import it from here — moved to
// shared/domain/e164.ts once the customers module needed the same pattern
// too (docs/13's own "shared utility" framing for this), kept re-exported
// here rather than touching every existing import site for a pure rename.
export { E164_PATTERN };

export class SearchCustomerDto {
  @ApiProperty()
  @IsUUID()
  integrationId!: string;

  @ApiProperty({ example: "+15551234567", description: "E.164 format" })
  @Matches(E164_PATTERN, { message: "phoneE164 must be a valid E.164 phone number" })
  phoneE164!: string;
}
