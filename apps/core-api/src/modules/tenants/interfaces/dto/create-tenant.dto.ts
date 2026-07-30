import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, Length } from "class-validator";

export class CreateTenantDto {
  @ApiProperty({ example: "All Phase Plumbing Inc" })
  @IsString()
  @Length(1, 200)
  name!: string;

  @ApiPropertyOptional({ example: "trial", description: 'Defaults to "trial" if omitted.' })
  @IsOptional()
  @IsString()
  planTier?: string;
}
