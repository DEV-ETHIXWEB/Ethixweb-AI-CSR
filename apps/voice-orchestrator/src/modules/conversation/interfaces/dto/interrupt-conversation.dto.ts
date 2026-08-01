import { ApiProperty } from "@nestjs/swagger";
import { IsUUID } from "class-validator";

export class InterruptConversationDto {
  @ApiProperty()
  @IsUUID()
  tenantId!: string;
}
