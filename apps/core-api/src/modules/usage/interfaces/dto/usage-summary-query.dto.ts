import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsDateString, IsIn, IsOptional, IsUUID } from "class-validator";
import { USAGE_TYPES } from "../../domain/usage-record.entity";

export class UsageSummaryQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  businessId?: string;

  @ApiPropertyOptional({ enum: USAGE_TYPES })
  @IsOptional()
  @IsIn(USAGE_TYPES)
  usageType?: (typeof USAGE_TYPES)[number];

  @ApiProperty({ description: "ISO-8601, inclusive lower bound." })
  @IsDateString()
  from!: string;

  @ApiProperty({ description: "ISO-8601, exclusive upper bound." })
  @IsDateString()
  to!: string;
}
