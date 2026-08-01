import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsString, IsUUID, Length } from "class-validator";
import { EMERGENCY_ACTIONS, EMERGENCY_SEVERITIES } from "../../domain/emergency-rule.entity";

export class CreateEmergencyRuleDto {
  @ApiProperty()
  @IsUUID()
  businessId!: string;

  @ApiProperty({ example: "burst pipe" })
  @IsString()
  @Length(1, 200)
  keywordOrPattern!: string;

  @ApiProperty({ enum: EMERGENCY_SEVERITIES })
  @IsIn(EMERGENCY_SEVERITIES)
  severity!: (typeof EMERGENCY_SEVERITIES)[number];

  @ApiProperty({ enum: EMERGENCY_ACTIONS })
  @IsIn(EMERGENCY_ACTIONS)
  escalationAction!: (typeof EMERGENCY_ACTIONS)[number];
}
