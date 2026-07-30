import { ApiProperty } from "@nestjs/swagger";
import { IsString, Length, MaxLength } from "class-validator";
import { MAX_TIMEZONE_LENGTH } from "./create-business.dto";

export class UpdateBusinessDto {
  @ApiProperty({ example: "All Phase Plumbing — Main Office" })
  @IsString()
  @Length(1, 200)
  name!: string;

  @ApiProperty({ example: "America/Chicago", description: "IANA timezone identifier" })
  @IsString()
  @MaxLength(MAX_TIMEZONE_LENGTH)
  timezone!: string;
}
