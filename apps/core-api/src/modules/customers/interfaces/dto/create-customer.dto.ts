import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEmail, IsObject, IsOptional, IsString, IsUUID, Length, Matches } from "class-validator";
import { E164_PATTERN } from "../../../../shared/domain/e164";

export class CreateCustomerDto {
  @ApiProperty()
  @IsUUID()
  businessId!: string;

  @ApiProperty({ example: "Jane Doe" })
  @IsString()
  @Length(1, 200)
  name!: string;

  @ApiProperty({ example: "+15551234567" })
  @Matches(E164_PATTERN, { message: "phoneE164 must be a valid E.164 phone number" })
  phoneE164!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  address?: Record<string, unknown>;
}
