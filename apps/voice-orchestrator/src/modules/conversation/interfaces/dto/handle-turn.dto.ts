import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from "class-validator";

export class HandleTurnDto {
  @ApiProperty()
  @IsUUID()
  tenantId!: string;

  @ApiProperty({ description: "The finalized caller utterance from the runtime's STT." })
  @IsString()
  @Length(1, 8000)
  transcript!: string;

  @ApiPropertyOptional({
    description: "STT confidence 0-1 — surfaced to the model per docs/03 §5.",
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  sttConfidence?: number;

  @ApiPropertyOptional({ description: "Milliseconds since call start." })
  @IsOptional()
  @IsInt()
  @Min(0)
  offsetMs?: number;

  @ApiProperty({
    description: "This agent config's tool allowlist — docs/04 §2 stage 2's authorization input.",
    type: [String],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  allowedTools!: string[];
}
