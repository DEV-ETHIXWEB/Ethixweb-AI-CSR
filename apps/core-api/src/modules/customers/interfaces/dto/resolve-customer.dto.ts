import { ApiProperty } from "@nestjs/swagger";
import { IsUUID, Matches } from "class-validator";
import { E164_PATTERN } from "../../../../shared/domain/e164";

export class ResolveCustomerDto {
  @ApiProperty()
  @IsUUID()
  businessId!: string;

  @ApiProperty({ example: "+15551234567", description: "E.164 format" })
  @Matches(E164_PATTERN, { message: "phoneE164 must be a valid E.164 phone number" })
  phoneE164!: string;
}
