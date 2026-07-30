import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsEmail,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from "class-validator";
import { E164_PATTERN } from "./search-customer.dto";

export class CreateCustomerDto {
  @ApiProperty()
  @IsUUID()
  integrationId!: string;

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

  @ApiPropertyOptional({
    description:
      "Opt-in — supply a stable key to make retrying this exact request safe (returns the first call's result instead of creating a duplicate customer).",
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  idempotencyKey?: string;
}
