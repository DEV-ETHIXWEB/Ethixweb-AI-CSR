import { ApiProperty } from "@nestjs/swagger";
import { IsString, Length } from "class-validator";

export class UpdateTenantDto {
  @ApiProperty({ example: "All Phase Plumbing Inc" })
  @IsString()
  @Length(1, 200)
  name!: string;
}
