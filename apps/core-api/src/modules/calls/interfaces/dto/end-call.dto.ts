import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsDateString, IsIn, IsOptional, IsString, Length } from "class-validator";

const TERMINAL_STATUSES = ["completed", "abandoned"] as const;

export class EndCallDto {
  @ApiProperty({ enum: TERMINAL_STATUSES })
  @IsIn(TERMINAL_STATUSES)
  status!: (typeof TERMINAL_STATUSES)[number];

  @ApiPropertyOptional({ example: "caller_hangup" })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  endReason?: string;

  @ApiProperty({ description: "ISO-8601 timestamp of when the call actually ended." })
  @IsDateString()
  endedAt!: string;
}
