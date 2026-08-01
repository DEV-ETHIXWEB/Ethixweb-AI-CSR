import { ApiProperty } from "@nestjs/swagger";
import { IsString, IsUUID, Length } from "class-validator";

export class EndConversationDto {
  @ApiProperty()
  @IsUUID()
  tenantId!: string;

  @ApiProperty({ example: "caller_hangup" })
  @IsString()
  @Length(1, 100)
  endReason!: string;
}
