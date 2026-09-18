import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsString, IsUUID, Length } from "class-validator";
import type { TransferToHumanReason } from "../../application/transfer-to-human.use-case";

const REASONS: TransferToHumanReason[] = [
  "caller_requested",
  "cannot_help",
  "caller_frustrated",
  "business_workflow",
];

/** docs/04 §3.9 transferToHuman — tool-broker-facing, API-key auth only (see EmergencyRulesToolController's own comment). */
export class TransferToHumanToolDto {
  @ApiProperty()
  @IsUUID()
  businessId!: string;

  @ApiProperty()
  @IsUUID()
  callId!: string;

  @ApiProperty({ enum: REASONS })
  @IsIn(REASONS)
  reason!: TransferToHumanReason;

  @ApiProperty({ description: "Grace's own one-line handoff summary for the human who picks up." })
  @IsString()
  @Length(1, 1000)
  summary!: string;
}
