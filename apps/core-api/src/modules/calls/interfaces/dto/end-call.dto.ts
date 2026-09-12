import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from "class-validator";

const TERMINAL_STATUSES = ["completed", "abandoned"] as const;
const SPEAKERS = ["caller", "agent"] as const;

/**
 * One turn of the conversation, as the Voice Orchestrator saw it.
 *
 * Sent at call-end rather than per-turn on purpose: the orchestrator
 * already holds the full transcript in its Conversation aggregate, the
 * end-call call is already being made, and a per-turn write would put a
 * database round-trip on the live speech path for data nobody reads
 * until after the call.
 */
export class TranscriptTurnDto {
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  turnIndex!: number;

  @ApiProperty({ enum: SPEAKERS })
  @IsIn(SPEAKERS)
  speaker!: (typeof SPEAKERS)[number];

  @ApiProperty()
  @IsString()
  @Length(1, 8000)
  text!: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  offsetMs?: number;
}

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

  /**
   * OPTIONAL by design. Ending a call must never fail because a
   * transcript was missing, malformed or oversized — a call that ends
   * without its transcript is a lesser problem than a call that cannot
   * be marked ended at all (which would leave its capacity reservation
   * held and its lifecycle open).
   */
  @ApiPropertyOptional({ type: [TranscriptTurnDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => TranscriptTurnDto)
  transcript?: TranscriptTurnDto[];
}
